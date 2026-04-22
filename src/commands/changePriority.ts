import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { pickFieldValue } from '../ui/pickers';

export async function changePriority(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const current = issue.customFields.find((f) => f.name === 'Priority');
  const currentName = current?.value.kind === 'enum' ? current.value.name : undefined;
  const picked = await pickFieldValue(client, issue.project.id, 'Priority', {
    title: `Change priority of ${issueId}`,
    currentValue: currentName,
  });
  if (!picked?.name) return;
  await client.setPriority(issueId, picked.name);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} priority → ${picked.name}`);
}
