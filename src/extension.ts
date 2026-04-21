import * as vscode from 'vscode';
import { YouTrackClient } from './client/youtrackClient';
import { Cache } from './cache/cache';
import { AuthStore } from './auth/authStore';
import { SidebarState, type GroupMode, type SortMode } from './ui/sidebarState';
import { QueryTreeProvider, type QuerySource } from './ui/queryTreeProvider';
import { MultiQueryTreeProvider } from './ui/multiQueryTreeProvider';
import { BoardTreeProvider } from './ui/boardTreeProvider';
import { IssueDetailPanel } from './ui/issueDetailPanel';
import { goToIssue } from './commands/goToIssue';
import { search } from './commands/search';
import { CreateIssuePanel } from './ui/createIssuePanel';
import { assignToMe } from './commands/assignToMe';
import { changeAssignee } from './commands/changeAssignee';
import { changeState } from './commands/changeState';
import { changePriority } from './commands/changePriority';
import { editFieldByName } from './commands/editCustomField';
import { postBranchActivity } from './commands/postBranchActivity';
import { createIssueFromSelection } from './commands/createIssueFromSelection';
import { logTime } from './commands/logTime';
import { createBranch } from './commands/createBranch';
import { StatusBar } from './ui/statusBar';
import { openBoard } from './commands/openBoard';
import { UriHandler } from './ui/uriHandler';
import { IssueHoverProvider } from './ui/hoverProvider';
import { IssueCodeLensProvider } from './ui/codeLensProvider';
import { RecentsTreeProvider } from './ui/recentsTreeProvider';
import { NotificationsTreeProvider } from './ui/notificationsTreeProvider';
import { TimerService } from './ui/timer';
import { CurrentIssueBadge } from './ui/currentIssueBadge';
import { CommitTemplateService } from './ui/commitTemplate';
import { resolveIssueId } from './commands/resolveIssueId';

interface SectionDef {
  viewId: string;
  source: QuerySource;
}

const TOP_SECTIONS: SectionDef[] = [
  { viewId: 'youtrack.assignedToMe', source: { label: 'Assigned to me', savedQueryName: 'Assigned to me', directQuery: 'for: me #Unresolved' } },
];

const ISSUES_SUBSECTIONS: Array<{ id: string; label: string; source: QuerySource }> = [
  { id: 'reportedByMe',  label: 'Reported by me',  source: { label: 'Reported by me',  savedQueryName: 'Reported by me',  directQuery: 'reporter: me' } },
  { id: 'commentedByMe', label: 'Commented by me', source: { label: 'Commented by me', savedQueryName: 'Commented by me', directQuery: 'commented by: me' } },
  { id: 'allIssues',     label: 'All issues',      source: { label: 'All issues',      savedQueryName: 'All issues',      directQuery: '' } },
  { id: 'allTickets',    label: 'All tickets',     source: { label: 'All tickets',     savedQueryName: 'All tickets',     directQuery: '' } },
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const auth = new AuthStore(context);

  await vscode.commands.executeCommand('setContext', 'youtrack.signedIn', false);

  context.subscriptions.push(
    vscode.commands.registerCommand('youtrack.signIn', async () => {
      const signed = await auth.promptAndValidate();
      if (!signed) return;
      const pick = await vscode.window.showInformationMessage(
        'YouTrack: signed in. Reload the window to finish activation.',
        'Reload Window',
      );
      if (pick === 'Reload Window') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }),
  );

  let creds = await auth.getCredentials();
  if (!creds) creds = await auth.promptAndValidate();
  if (!creds) return;

  const client = new YouTrackClient(creds.baseUrl, creds.token);
  const cfg = vscode.workspace.getConfiguration('youtrack');

  const cache = new Cache({
    issuesTtlMs: cfg.get<number>('cache.ttl.issues', 60) * 1000,
    maxIssues: 10_000,
    fieldSchemasTtlMs: cfg.get<number>('cache.ttl.fieldSchemas', 3600) * 1000,
    savedQueriesTtlMs: cfg.get<number>('cache.ttl.savedSearches', 300) * 1000,
  });

  const initialGroup: GroupMode = cfg.get<string>('sidebar.groupBy', 'project') === 'none' ? 'none' : 'project';

  // One state per top-level view so filters/sort/group are independent
  const assignedState = new SidebarState();
  const issuesState = new SidebarState();
  assignedState.groupMode = initialGroup;
  issuesState.groupMode = initialGroup;
  assignedState.unresolvedOnly = true; // sensible default for "what am I working on?"

  const assignedProvider = new QueryTreeProvider(
    'youtrack.assignedToMe', client, cache, assignedState,
    TOP_SECTIONS[0].source,
  );
  const issuesProvider = new MultiQueryTreeProvider(
    'youtrack.issues', client, cache, issuesState, ISSUES_SUBSECTIONS,
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('youtrack.assignedToMe', assignedProvider),
    vscode.window.registerTreeDataProvider('youtrack.issues', issuesProvider),
    vscode.commands.registerCommand('youtrack.loadMoreInSection', (sectionId: string) => issuesProvider.loadMore(sectionId)),
    vscode.commands.registerCommand('youtrack.loadMoreInView', async (viewId: string) => {
      if (viewId === 'youtrack.assignedToMe') await assignedProvider.loadMore();
    }),
  );

  await registerScopedCommands(context, 'assignedToMe', assignedState, () => assignedProvider.refresh(), () => assignedProvider.getAllLoaded());
  await registerScopedCommands(context, 'issues',       issuesState,   () => issuesProvider.refresh(),   () => issuesProvider.getAllLoaded());

  const refreshAll = () => { assignedProvider.refresh(); issuesProvider.refresh(); };

  context.subscriptions.push(
    vscode.commands.registerCommand('youtrack.refresh', () => refreshAll()),
    vscode.commands.registerCommand('youtrack.openIssue', async (id: string) => {
      IssueDetailPanel.show(context.extensionUri, client, cache, id, context);
      try {
        const issue = await cache.getIssue(id, (x) => client.fetchIssue(x));
        await recents.touch(issue.idReadable, issue.summary);
      } catch { /* opening shouldn't fail because of recents */ }
    }),
    vscode.commands.registerCommand('youtrack.goToIssue', async () => {
      const id = await goToIssue();
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
    }),
    vscode.commands.registerCommand('youtrack.search', async () => {
      const id = await search(client);
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
    }),
    vscode.commands.registerCommand('youtrack.createIssueFromSelection', () => {
      createIssueFromSelection(context.extensionUri, client);
    }),
    vscode.commands.registerCommand('youtrack.createIssue', () => {
      CreateIssuePanel.show(context.extensionUri, client);
    }),
    vscode.commands.registerCommand('youtrack.assignToMe', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await assignToMe(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.changeAssignee', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await changeAssignee(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.changeState', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await changeState(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.changePriority', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await changePriority(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.postBranchActivity', () => postBranchActivity(client, cache)),
    vscode.commands.registerCommand('youtrack.editField', async (arg: { id?: string; field?: string } | unknown) => {
      const obj = (arg && typeof arg === 'object') ? arg as any : {};
      const issueId = await resolveIssueId(obj.id ?? arg);
      const fieldName = typeof obj.field === 'string' ? obj.field : undefined;
      if (!issueId || !fieldName) return;
      await editFieldByName(client, cache, issueId, fieldName);
    }),
    vscode.commands.registerCommand('youtrack.logTime', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await logTime(client, issueId);
    }),
    vscode.commands.registerCommand('youtrack.createBranch', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await createBranch(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.copyId', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await vscode.env.clipboard.writeText(issueId);
      vscode.window.showInformationMessage(`YouTrack: copied ${issueId}`);
    }),
    vscode.commands.registerCommand('youtrack.copyLink', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      const url = `${creds!.baseUrl.replace(/\/$/, '')}/issue/${issueId}`;
      await vscode.env.clipboard.writeText(url);
      vscode.window.showInformationMessage(`YouTrack: copied ${url}`);
    }),
    vscode.commands.registerCommand('youtrack.openInBrowser', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      const url = `${creds!.baseUrl.replace(/\/$/, '')}/issue/${issueId}`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('youtrack.startWork', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await changeState(client, cache, issueId);
      await createBranch(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.openBoard', (boardId?: string) =>
      openBoard(context.extensionUri, client, typeof boardId === 'string' ? boardId : undefined),
    ),
  );

  const boardTree = new BoardTreeProvider(client);
  const recents = new RecentsTreeProvider(context);
  const notifs = new NotificationsTreeProvider(client);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('youtrack.boards', boardTree),
    vscode.window.registerTreeDataProvider('youtrack.recents', recents),
    vscode.window.registerTreeDataProvider('youtrack.notifications', notifs),
    vscode.commands.registerCommand('youtrack.refreshBoards', () => boardTree.refresh()),
    vscode.commands.registerCommand('youtrack.refreshRecents', () => recents['_emitter'].fire(undefined)),
    vscode.commands.registerCommand('youtrack.clearRecents', () => recents.clear()),
    vscode.commands.registerCommand('youtrack.refreshNotifications', () => notifs.refresh()),
    vscode.commands.registerCommand('youtrack.markNotificationRead', async (n: any) => {
      const id = n?.id ?? (typeof n === 'string' ? n : undefined);
      if (!id) return;
      try {
        await client.markNotificationRead(id, true);
        notifs.refresh();
      } catch (e) {
        vscode.window.showWarningMessage(`YouTrack: mark-read failed: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('youtrack.markAllNotificationsRead', async () => {
      const ids = notifs.unreadIds();
      if (!ids.length) {
        vscode.window.showInformationMessage('YouTrack: no unread notifications.');
        return;
      }
      await client.markAllNotificationsRead(ids);
      notifs.refresh();
    }),
  );

  const timer = new TimerService(context, client);
  const currentIssue = new CurrentIssueBadge(client, cache);
  const commitTemplate = new CommitTemplateService();
  context.subscriptions.push(
    timer,
    currentIssue,
    commitTemplate,
    vscode.commands.registerCommand('youtrack.insertIssueKeyInCommitMessage', () => commitTemplate.insertNow()),
    vscode.commands.registerCommand('youtrack.startTimer', async (arg?: unknown) => {
      const id = await resolveIssueId(arg);
      if (id) await timer.start(id);
    }),
    vscode.commands.registerCommand('youtrack.stopTimer', () => timer.stop()),
    vscode.commands.registerCommand('youtrack.timerClick', () => timer.toggleFromStatusBar()),
  );

  await vscode.commands.executeCommand('setContext', 'youtrack.signedIn', true);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      new IssueHoverProvider(client, cache, creds.baseUrl),
    ),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      new IssueCodeLensProvider(client, cache),
    ),
  );

  const pollMs = cfg.get<number>('cache.pollInterval', 60) * 1000;
  const statusBar = new StatusBar(client, pollMs);
  statusBar.start();
  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand('youtrack.statusBarClick', () => statusBar.click()),
  );

  context.subscriptions.push(
    vscode.window.registerUriHandler(new UriHandler()),
    vscode.commands.registerCommand('youtrack.signOut', async () => {
      await auth.signOut();
      await vscode.commands.executeCommand('setContext', 'youtrack.signedIn', false);
      vscode.window.showInformationMessage('YouTrack: signed out. Reload window to re-authenticate.');
    }),
  );
}

export function deactivate(): void {
  // subscriptions handle cleanup
}

async function registerScopedCommands(
  ctx: vscode.ExtensionContext,
  scope: 'assignedToMe' | 'issues',
  state: SidebarState,
  refresh: () => void,
  getLoaded: () => import('./client/types').Issue[],
): Promise<void> {
  const base = `youtrack.${scope}`;
  const setCtx = (key: string, v: unknown) => vscode.commands.executeCommand('setContext', key, v);

  // initial context keys
  await setCtx(`${base}.filterActive`, false);
  await setCtx(`${base}.stateFilterActive`, false);
  await setCtx(`${base}.tagFilterActive`, false);
  await setCtx(`${base}.sortNonDefault`, false);
  await setCtx(`${base}.groupedByProject`, state.groupMode === 'project');
  await setCtx(`${base}.unresolvedOnly`, state.unresolvedOnly);

  ctx.subscriptions.push(
    vscode.commands.registerCommand(`${base}.filter`, async () => {
      const text = await vscode.window.showInputBox({
        prompt: `Filter ${scope === 'assignedToMe' ? 'Assigned to me' : 'Issues'}`,
        placeHolder: 'id, summary, assignee, project',
        value: state.filterText,
        ignoreFocusOut: true,
      });
      if (text === undefined) return;
      state.setFilterText(text);
      await setCtx(`${base}.filterActive`, text.trim().length > 0);
    }),
    vscode.commands.registerCommand(`${base}.clearFilter`, async () => {
      state.setFilterText('');
      await setCtx(`${base}.filterActive`, false);
    }),
    vscode.commands.registerCommand(`${base}.groupByProject`, async () => {
      state.setGroupMode('project');
      await setCtx(`${base}.groupedByProject`, true);
    }),
    vscode.commands.registerCommand(`${base}.groupFlat`, async () => {
      state.setGroupMode('none');
      await setCtx(`${base}.groupedByProject`, false);
    }),
    vscode.commands.registerCommand(`${base}.filterByState`, async () => {
      const loaded = getLoaded();
      const states = [...new Set(loaded.map((i) => {
        const f = i.customFields.find((f) => f.name === 'State');
        if (!f) return '';
        if (f.value.kind === 'state' || f.value.kind === 'enum') return f.value.name;
        return '';
      }).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      if (!states.length) {
        vscode.window.showInformationMessage('YouTrack: expand a section first so the sidebar knows which states exist.');
        return;
      }
      const current = state.stateFilter;
      const picks = await vscode.window.showQuickPick(
        states.map((s) => ({ label: s, picked: current.has(s) })),
        { canPickMany: true, placeHolder: 'Pick states to show (none = show all)', ignoreFocusOut: true },
      );
      if (!picks) return;
      const selected = picks.map((p) => p.label);
      state.setStateFilter(selected);
      await setCtx(`${base}.stateFilterActive`, selected.length > 0);
    }),
    vscode.commands.registerCommand(`${base}.clearStateFilter`, async () => {
      state.setStateFilter([]);
      await setCtx(`${base}.stateFilterActive`, false);
    }),
    vscode.commands.registerCommand(`${base}.filterByTag`, async () => {
      const loaded = getLoaded();
      const tags = [...new Set(loaded.flatMap((i) => i.tags.map((t) => t.name)))].sort((a, b) => a.localeCompare(b));
      if (!tags.length) {
        vscode.window.showInformationMessage('YouTrack: expand a section first so the sidebar knows which tags exist.');
        return;
      }
      const current = state.tagFilter;
      const picks = await vscode.window.showQuickPick(
        tags.map((t) => ({ label: t, picked: current.has(t) })),
        { canPickMany: true, placeHolder: 'Pick tags to show (none = show all)', ignoreFocusOut: true },
      );
      if (!picks) return;
      const selected = picks.map((p) => p.label);
      state.setTagFilter(selected);
      await setCtx(`${base}.tagFilterActive`, selected.length > 0);
    }),
    vscode.commands.registerCommand(`${base}.clearTagFilter`, async () => {
      state.setTagFilter([]);
      await setCtx(`${base}.tagFilterActive`, false);
    }),
    vscode.commands.registerCommand(`${base}.sortBy`, async () => {
      const labels: Record<SortMode, string> = {
        default: 'Default (saved search order)',
        updated: 'Recently updated',
        created: 'Recently created',
        id: 'Issue ID',
      };
      const current = state.sortMode;
      const picks = (['default', 'updated', 'created', 'id'] as SortMode[]).map((m) => ({
        label: labels[m], mode: m, description: m === current ? '(current)' : '',
      }));
      const picked = await vscode.window.showQuickPick(picks, { placeHolder: 'Sort issues by…', ignoreFocusOut: true });
      if (!picked) return;
      state.setSortMode(picked.mode);
      await setCtx(`${base}.sortNonDefault`, picked.mode !== 'default');
    }),
    vscode.commands.registerCommand(`${base}.refresh`, () => refresh()),
    vscode.commands.registerCommand(`${base}.hideResolved`, async () => {
      state.setUnresolvedOnly(true);
      await setCtx(`${base}.unresolvedOnly`, true);
    }),
    vscode.commands.registerCommand(`${base}.showAll`, async () => {
      state.setUnresolvedOnly(false);
      await setCtx(`${base}.unresolvedOnly`, false);
    }),
  );
}
