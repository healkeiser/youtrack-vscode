import * as vscode from 'vscode';
import Database from 'better-sqlite3';
import * as path from 'node:path';
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

  await vscode.commands.executeCommand('setContext', 'youtrack.signedIn', true);

  const client = new YouTrackClient(creds.baseUrl, creds.token);
  const dbPath = path.join(context.globalStorageUri.fsPath, 'cache.sqlite');
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  const db = new Database(dbPath);
  const cfg = vscode.workspace.getConfiguration('youtrack');
  const cache = new Cache(db, {
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
    vscode.commands.registerCommand('youtrack.assignToMe', async (id?: string) => {
      const issueId = id ?? await vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
      if (!issueId) return;
      await assignToMe(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.changeState', async (id?: string) => {
      const issueId = id ?? await vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
      if (!issueId) return;
      await changeState(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.logTime', async (id?: string) => {
      const issueId = id ?? await vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
      if (!issueId) return;
      await logTime(client, issueId);
    }),
    vscode.commands.registerCommand('youtrack.createBranch', async (id?: string) => {
      const issueId = id ?? await vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
      if (!issueId) return;
      await createBranch(client, cache, issueId);
    }),
    vscode.commands.registerCommand('youtrack.openBoard', () => openBoard(context.extensionUri, client)),
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

  context.subscriptions.push({ dispose: () => db.close() });
}

export function deactivate(): void {
  // subscriptions handle cleanup
}
