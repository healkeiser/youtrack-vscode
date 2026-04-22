import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { pickFieldValue } from '../ui/pickers';

export async function changeState(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const current = issue.customFields.find((f) => f.name === 'State');
  const currentName = current?.value.kind === 'state' || current?.value.kind === 'enum' ? current.value.name : undefined;
  const picked = await pickFieldValue(client, issue.project.id, 'State', {
    title: `Change state of ${issueId}`,
    currentValue: currentName,
  });
  if (!picked?.name) return;
  await client.transitionState(issueId, picked.name);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} -> ${picked.name}`);
}
