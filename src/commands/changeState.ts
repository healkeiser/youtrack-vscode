import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { colorDotUri } from '../ui/colorDot';

export async function changeState(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const states = await client.fetchProjectFieldValuesDetailed(issue.project.id, 'State');
  if (!states.length) {
    vscode.window.showErrorMessage('YouTrack: no states configured for this project');
    return;
  }
  type Item = vscode.QuickPickItem & { name: string };
  const items: Item[] = states.map((s) => ({
    label: s.name,
    name: s.name,
    iconPath: colorDotUri(s.color?.background),
  }));
  const picked = await vscode.window.showQuickPick<Item>(items, {
    placeHolder: 'New state',
    ignoreFocusOut: true,
  });
  if (!picked) return;
  await client.transitionState(issueId, picked.name);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} -> ${picked.name}`);
}
