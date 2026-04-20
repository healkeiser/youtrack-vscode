import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';

export async function createIssue(client: YouTrackClient): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('youtrack');
  const defaultShort = cfg.get<string>('defaultProject', '');

  const projects = await client.listProjects();
  let projectId: string | undefined;
  if (defaultShort) {
    projectId = projects.find((p) => p.shortName === defaultShort)?.id;
  }
  if (!projectId) {
    const picked = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.shortName, description: p.name, id: p.id })),
      { placeHolder: 'Project' },
    );
    if (!picked) return null;
    projectId = picked.id;
  }

  const summary = await vscode.window.showInputBox({ prompt: 'Summary', validateInput: (v) => v ? null : 'Required' });
  if (!summary) return null;

  const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });

  const { idReadable } = await client.createIssue(projectId, summary, description ?? '');
  vscode.window.showInformationMessage(`YouTrack: created ${idReadable}`);
  return idReadable;
}
