import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { AgileBoardPanel } from '../ui/agileBoardPanel';

export async function openBoard(extensionUri: vscode.Uri, client: YouTrackClient): Promise<void> {
  const boards = await client.fetchAgileBoards();
  if (!boards.length) { vscode.window.showInformationMessage('YouTrack: no agile boards'); return; }

  const boardPick = boards.length === 1 ? { id: boards[0].id, label: boards[0].name } :
    await vscode.window.showQuickPick(boards.map((b) => ({ id: b.id, label: b.name })), { placeHolder: 'Board', ignoreFocusOut: true });
  if (!boardPick) return;

  const sprints = await client.fetchSprints(boardPick.id);
  const current = sprints.find((s) => s.current) ?? sprints[0];
  if (!current) { vscode.window.showInformationMessage('YouTrack: no sprints'); return; }

  const sprintPick = sprints.length === 1 ? current :
    (await vscode.window.showQuickPick(
      sprints.map((s) => ({ id: s.id, label: s.name, description: s.current ? '(current)' : '' })),
      { placeHolder: `Sprint (default: ${current.name})`, ignoreFocusOut: true },
    )) ?? current;

  AgileBoardPanel.show(extensionUri, client, boardPick.id, (sprintPick as { id: string }).id);
}
