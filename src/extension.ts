import * as vscode from 'vscode';
import Database from 'better-sqlite3';
import * as path from 'node:path';
import { YouTrackClient } from './client/youtrackClient';
import { Cache } from './cache/cache';
import { AuthStore } from './auth/authStore';
import { IssueTreeProvider } from './ui/issueTreeProvider';
import { IssueDetailPanel } from './ui/issueDetailPanel';
import { goToIssue } from './commands/goToIssue';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const auth = new AuthStore(context);
  let creds = await auth.getCredentials();
  if (!creds) creds = await auth.promptAndValidate();
  if (!creds) return;

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
  );

  context.subscriptions.push({ dispose: () => db.close() });
}

export function deactivate(): void {
  // subscriptions handle cleanup
}
