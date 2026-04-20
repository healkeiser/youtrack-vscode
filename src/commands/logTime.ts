import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { parseDuration } from '../domain/timeTracker';

export async function logTime(client: YouTrackClient, issueId: string): Promise<void> {
  const raw = await vscode.window.showInputBox({
    prompt: 'Duration',
    placeHolder: '1h30m',
    validateInput: (v) => (parseDuration(v) !== null ? null : 'Invalid duration'),
  });
  if (!raw) return;
  const seconds = parseDuration(raw)!;

  const dateStr = await vscode.window.showInputBox({
    prompt: 'Date (YYYY-MM-DD)',
    value: new Date().toISOString().slice(0, 10),
    validateInput: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'YYYY-MM-DD'),
  });
  if (!dateStr) return;

  const types = await client.listWorkItemTypes();
  const picked = types.length
    ? await vscode.window.showQuickPick([{ label: '(no type)', id: '' }, ...types.map((t) => ({ label: t.name, id: t.id }))], { placeHolder: 'Type' })
    : { id: '' };
  if (!picked) return;

  const text = await vscode.window.showInputBox({ prompt: 'Note (optional)' });

  await client.addWorkItem(issueId, {
    durationSeconds: seconds,
    date: new Date(dateStr).getTime(),
    typeId: (picked as any).id || undefined,
    text: text || undefined,
  });
  vscode.window.showInformationMessage(`YouTrack: logged ${raw} on ${issueId}`);
}
