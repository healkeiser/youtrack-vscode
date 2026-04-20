import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

export async function changeState(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const states = await client.fetchProjectStateValues(issue.project.id);
  if (!states.length) {
    vscode.window.showErrorMessage('YouTrack: no states configured for this project');
    return;
  }
  const picked = await vscode.window.showQuickPick(states, { placeHolder: 'New state' });
  if (!picked) return;
  await client.transitionState(issueId, picked);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} -> ${picked}`);
}
