import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { colorDotUri } from '../ui/colorDot';

export async function changePriority(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const values = await client.fetchProjectFieldValuesDetailed(issue.project.id, 'Priority');
  if (!values.length) {
    vscode.window.showErrorMessage('YouTrack: no priorities configured for this project');
    return;
  }
  type Item = vscode.QuickPickItem & { name: string };
  const items: Item[] = values.map((v) => ({
    label: v.name,
    name: v.name,
    iconPath: colorDotUri(v.color?.background),
  }));
  const picked = await vscode.window.showQuickPick<Item>(items, {
    placeHolder: 'New priority',
    ignoreFocusOut: true,
  });
  if (!picked) return;
  await client.setPriority(issueId, picked.name);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} priority → ${picked.name}`);
}
