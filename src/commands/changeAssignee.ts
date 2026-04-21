import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { primeUserAvatars, userAvatarUri } from '../ui/userAvatar';

export async function changeAssignee(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const users = await client.listUsers('', 200);
  if (!users.length) {
    vscode.window.showInformationMessage('YouTrack: no users found');
    return;
  }
  await primeUserAvatars(users.map((u) => u.avatarUrl));
  type Item = vscode.QuickPickItem & { login?: string };
  const items: Item[] = [
    { label: '$(circle-slash) Unassign', login: '' },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    ...users.map<Item>((u) => ({
      label: u.fullName || u.login,
      description: u.login,
      login: u.login,
      iconPath: userAvatarUri(u.avatarUrl) ?? new vscode.ThemeIcon('person'),
    })),
  ];
  const picked = await vscode.window.showQuickPick<Item>(items, {
    placeHolder: 'Assign to…',
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!picked || picked.login === undefined) return;
  await client.assignIssue(issueId, picked.login);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(
    picked.login ? `YouTrack: ${issueId} assigned to ${picked.login}` : `YouTrack: ${issueId} unassigned`,
  );
}
