import * as vscode from 'vscode';
import { YouTrackClient } from './client/youtrackClient';
import { Cache } from './cache/cache';
import { AuthStore } from './auth/authStore';
import { IssueTreeProvider } from './ui/issueTreeProvider';
import { IssueDetailPanel } from './ui/issueDetailPanel';
import { goToIssue } from './commands/goToIssue';
import { search } from './commands/search';
import { createIssue } from './commands/createIssue';
import { assignToMe } from './commands/assignToMe';
import { changeState } from './commands/changeState';
import { logTime } from './commands/logTime';
import { createBranch } from './commands/createBranch';
import { StatusBar } from './ui/statusBar';
import { openBoard } from './commands/openBoard';
import { UriHandler } from './ui/uriHandler';
import { IssueHoverProvider } from './ui/hoverProvider';
import { resolveIssueId } from './commands/resolveIssueId';

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

  const tree = new IssueTreeProvider(client, cache);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('youtrack.issues', tree),
    vscode.commands.registerCommand('youtrack.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('youtrack.loadMore', (id: string) => tree.loadMore(id)),
    vscode.commands.registerCommand('youtrack.filter', async () => {
      const current = tree.getFilter();
      const text = await vscode.window.showInputBox({
        prompt: 'Filter issues in sidebar',
        placeHolder: 'id, summary, assignee, project',
        value: current,
        ignoreFocusOut: true,
      });
      if (text === undefined) return;
      tree.setFilter(text);
      await vscode.commands.executeCommand('setContext', 'youtrack.filterActive', text.trim().length > 0);
    }),
    vscode.commands.registerCommand('youtrack.clearFilter', async () => {
      tree.setFilter('');
      await vscode.commands.executeCommand('setContext', 'youtrack.filterActive', false);
    }),
    vscode.commands.registerCommand('youtrack.openIssue', (id: string) =>
      IssueDetailPanel.show(context.extensionUri, client, cache, id),
    ),
    vscode.commands.registerCommand('youtrack.goToIssue', async () => {
      const id = await goToIssue();
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
    }),
    vscode.commands.registerCommand('youtrack.search', async () => {
      const id = await search(client);
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
    }),
    vscode.commands.registerCommand('youtrack.createIssue', async () => {
      const id = await createIssue(client);
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
    }),
    vscode.commands.registerCommand('youtrack.assignToMe', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await assignToMe(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.changeState', async (arg?: unknown) => {
      const issueId = await resolveIssueId(arg);
      if (!issueId) return;
      await changeState(client, cache, issueId);
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
    vscode.commands.registerCommand('youtrack.openBoard', () => openBoard(context.extensionUri, client)),
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
