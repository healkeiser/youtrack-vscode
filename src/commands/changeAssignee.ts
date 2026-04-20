import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

export async function changeAssignee(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const users = await client.listUsers('', 200);
  if (!users.length) {
    vscode.window.showInformationMessage('YouTrack: no users found');
    return;
  }
  const items = [
    { label: '(Unassign)', login: '', description: '' },
    ...users.map((u) => ({ label: u.login, description: u.fullName, login: u.login })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Assign to…',
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!picked) return;
  await client.assignIssue(issueId, picked.login);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(
    picked.login ? `YouTrack: ${issueId} assigned to ${picked.login}` : `YouTrack: ${issueId} unassigned`,
  );
}
