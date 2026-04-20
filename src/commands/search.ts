import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';

export async function search(client: YouTrackClient): Promise<string | null> {
  const query = await vscode.window.showInputBox({
    prompt: 'YouTrack query',
    placeHolder: 'project: FOO #Unresolved',
    ignoreFocusOut: true,
  });
  if (!query) return null;
  const issues = await client.searchIssues(query, 0, 50);
  if (!issues.length) {
    vscode.window.showInformationMessage('YouTrack: no matches');
    return null;
  }
  const picked = await vscode.window.showQuickPick(
    issues.map((i) => ({ label: i.idReadable, description: i.summary })),
    { placeHolder: 'Select an issue', ignoreFocusOut: true },
  );
  return picked?.label ?? null;
}
