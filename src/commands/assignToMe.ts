import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

export async function assignToMe(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const me = await client.getMe();
  await client.assignIssue(issueId, me.login);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} assigned to you`);
}
