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
import { logTime } from './commands/logTime';
import { createBranch } from './commands/createBranch';
import { StatusBar } from './ui/statusBar';
import { openBoard } from './commands/openBoard';
import { UriHandler } from './ui/uriHandler';
import { IssueHoverProvider } from './ui/hoverProvider';
import { RecentsTreeProvider } from './ui/recentsTreeProvider';
import { NotificationsTreeProvider } from './ui/notificationsTreeProvider';
import { TimerService } from './ui/timer';
import { CurrentIssueBadge } from './ui/currentIssueBadge';
import { resolveIssueId } from './commands/resolveIssueId';

interface SectionDef {
  viewId: string;
  source: QuerySource;
}

const TOP_SECTIONS: SectionDef[] = [
  { viewId: 'youtrack.assignedToMe', source: { label: 'Assigned to me', savedQueryName: 'Assigned to me', directQuery: 'for: me #Unresolved' } },
];

const ISSUES_SUBSECTIONS: Array<{ id: string; label: string; source: QuerySource }> = [
  { id: 'openIssues',    label: 'Open issues',     source: { label: 'Open issues',     directQuery: '#Unresolved' } },
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

  const state = new SidebarState();
  const initialGroup: GroupMode = cfg.get<string>('sidebar.groupBy', 'project') === 'none' ? 'none' : 'project';
  state.groupMode = initialGroup;
  await vscode.commands.executeCommand('setContext', 'youtrack.groupedByProject', initialGroup === 'project');

  const providers = new Map<string, QueryTreeProvider>();
  for (const section of TOP_SECTIONS) {
    const provider = new QueryTreeProvider(section.viewId, client, cache, state, section.source);
    providers.set(section.viewId, provider);
    context.subscriptions.push(vscode.window.registerTreeDataProvider(section.viewId, provider));
  }

  const multi = new MultiQueryTreeProvider('youtrack.issues', client, cache, state, ISSUES_SUBSECTIONS);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('youtrack.issues', multi),
    vscode.commands.registerCommand('youtrack.loadMoreInSection', (sectionId: string) => multi.loadMore(sectionId)),
  );

  const refreshAll = () => { for (const p of providers.values()) p.refresh(); multi.refresh(); };
  const collectLoadedIssues = () => {
    const out: import('./client/types').Issue[] = [];
    for (const p of providers.values()) out.push(...p.getAllLoaded());
    out.push(...multi.getAllLoaded());
    return out;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('youtrack.refresh', () => refreshAll()),
    vscode.commands.registerCommand('youtrack.loadMoreInView', async (viewId: string) => {
      const p = providers.get(viewId);
      if (p) await p.loadMore();
    }),
    vscode.commands.registerCommand('youtrack.filter', async () => {
      const text = await vscode.window.showInputBox({
        prompt: 'Filter issues in sidebar',
        placeHolder: 'id, summary, assignee, project',
        value: state.filterText,
        ignoreFocusOut: true,
      });
      if (text === undefined) return;
      state.setFilterText(text);
      await vscode.commands.executeCommand('setContext', 'youtrack.filterActive', text.trim().length > 0);
    }),
    vscode.commands.registerCommand('youtrack.clearFilter', async () => {
      state.setFilterText('');
      await vscode.commands.executeCommand('setContext', 'youtrack.filterActive', false);
    }),
    vscode.commands.registerCommand('youtrack.groupByProject', async () => {
      state.setGroupMode('project');
      await vscode.workspace.getConfiguration('youtrack').update('sidebar.groupBy', 'project', vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('setContext', 'youtrack.groupedByProject', true);
    }),
    vscode.commands.registerCommand('youtrack.groupFlat', async () => {
      state.setGroupMode('none');
      await vscode.workspace.getConfiguration('youtrack').update('sidebar.groupBy', 'none', vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('setContext', 'youtrack.groupedByProject', false);
    }),
    vscode.commands.registerCommand('youtrack.filterByState', async () => {
      const loaded = collectLoadedIssues();
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
      await vscode.commands.executeCommand('setContext', 'youtrack.stateFilterActive', selected.length > 0);
    }),
    vscode.commands.registerCommand('youtrack.clearStateFilter', async () => {
      state.setStateFilter([]);
      await vscode.commands.executeCommand('setContext', 'youtrack.stateFilterActive', false);
    }),
    vscode.commands.registerCommand('youtrack.filterByTag', async () => {
      const loaded = collectLoadedIssues();
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
      await vscode.commands.executeCommand('setContext', 'youtrack.tagFilterActive', selected.length > 0);
    }),
    vscode.commands.registerCommand('youtrack.clearTagFilter', async () => {
      state.setTagFilter([]);
      await vscode.commands.executeCommand('setContext', 'youtrack.tagFilterActive', false);
    }),
    vscode.commands.registerCommand('youtrack.sortBy', async () => {
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
      await vscode.commands.executeCommand('setContext', 'youtrack.sortNonDefault', picked.mode !== 'default');
    }),
    vscode.commands.registerCommand('youtrack.openIssue', async (id: string) => {
      IssueDetailPanel.show(context.extensionUri, client, cache, id);
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
  );

  const timer = new TimerService(context, client);
  const currentIssue = new CurrentIssueBadge(client, cache);
  context.subscriptions.push(
    timer,
    currentIssue,
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
