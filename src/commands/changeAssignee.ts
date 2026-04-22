import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { pickUser } from '../ui/pickers';

export async function changeAssignee(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const assigneeField = issue.customFields.find((f) => f.name === 'Assignee');
  const currentLogin = assigneeField?.value.kind === 'user' ? assigneeField.value.login : undefined;
  const picked = await pickUser(client, `Assign ${issueId}`, {
    allowClear: true,
    clearLabel: 'Unassign',
    currentValue: currentLogin,
  });
  if (!picked) return;
  await client.assignIssue(issueId, picked.login ?? '');
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(
    picked.login ? `YouTrack: ${issueId} assigned to ${picked.login}` : `YouTrack: ${issueId} unassigned`,
  );
}
