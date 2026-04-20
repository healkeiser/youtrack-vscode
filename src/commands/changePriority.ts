import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

export async function changePriority(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const values = await client.fetchProjectPriorityValues(issue.project.id);
  if (!values.length) {
    vscode.window.showErrorMessage('YouTrack: no priorities configured for this project');
    return;
  }
  const picked = await vscode.window.showQuickPick(values, { placeHolder: 'New priority', ignoreFocusOut: true });
  if (!picked) return;
  await client.setPriority(issueId, picked);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} priority → ${picked}`);
}
