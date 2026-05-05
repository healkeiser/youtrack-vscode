import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { AgileBoardPanel } from '../ui/agileBoardPanel';

export async function openBoard(
  extensionUri: vscode.Uri,
  client: YouTrackClient,
  cache: Cache,
  context: vscode.ExtensionContext,
  preferredBoardId?: string,
): Promise<void> {
  const boards = await client.fetchAgileBoards();
  if (!boards.length) { vscode.window.showInformationMessage('YouTrack: no agile boards'); return; }

  let boardFull = preferredBoardId ? boards.find((b) => b.id === preferredBoardId) : undefined;
  if (!boardFull) {
    if (boards.length === 1) {
      boardFull = boards[0];
    } else {
      const picked = await vscode.window.showQuickPick(
        boards.map((b) => ({ id: b.id, label: b.name, description: b.sprintsEnabled ? '' : 'no sprints' })),
        { placeHolder: 'Board', ignoreFocusOut: true },
      );
      if (!picked) return;
      boardFull = boards.find((b) => b.id === picked.id);
    }
  }
  if (!boardFull) return;

  // Sprint-less boards skip the sprint picker entirely and open at the
  // board root (no sprintId). fetchSprints on such a board typically
  // returns a synthetic single sprint that YouTrack uses internally —
  // we still pick it up so the board view URL works, but we don't
  // prompt the user to choose anything.
  const sprints = await client.fetchSprints(boardFull.id);
  let sprintId = '';
  let sprintName = '';

  if (boardFull.sprintsEnabled && sprints.length) {
    const current = sprints.find((s) => s.current) ?? sprints[0];
    const sprintPick = sprints.length === 1 ? current :
      (await vscode.window.showQuickPick(
        sprints.map((s) => ({ id: s.id, label: s.name, description: s.current ? '(current)' : '' })),
        { placeHolder: `Sprint (default: ${current.name})`, ignoreFocusOut: true },
      )) ?? current;
    sprintId = (sprintPick as { id: string }).id;
    sprintName = (sprintPick as { label?: string; name?: string }).label
      ?? (sprintPick as { name?: string }).name
      ?? '';
  } else if (sprints.length) {
    // Disabled-sprints boards still have one backing sprint in the
    // API; use it silently so we can hit /api/agiles/{id}/sprints/{sid}/board.
    sprintId = sprints[0].id;
  }

  const title = sprintName ? `${boardFull.name} · ${sprintName}` : boardFull.name;
  AgileBoardPanel.show(extensionUri, client, cache, boardFull.id, sprintId, title, context);
}
