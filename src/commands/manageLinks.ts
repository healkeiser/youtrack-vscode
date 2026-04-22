import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { showYouTrackError } from '../client/errors';

// Two-step picker: choose a link verb (e.g. "depends on"), then enter the
// target issue ID. YouTrack's /commands endpoint accepts the same free-form
// syntax as the in-app command window, so we just post that string.
export async function manageLinks(
  client: YouTrackClient,
  cache: Cache,
  issueId: string,
): Promise<void> {
  try {
    const issue = await cache.getIssue(issueId, (id) => client.fetchIssue(id));
    const types = await client.listIssueLinkTypes();

    type Item = vscode.QuickPickItem & { verb?: string; remove?: { verb: string; target: string } };
    const existing: Item[] = [];
    for (const link of issue.links) {
      const verb = link.direction === 'INWARD' ? link.name : link.name;
      for (const i of link.issues) {
        existing.push({
          label: `$(trash) Remove: ${verb} ${i.idReadable}`,
          description: i.summary,
          remove: { verb, target: i.idReadable },
        });
      }
    }

    const addItems: Item[] = [];
    for (const t of types.sort((a, b) => a.sourceToTarget.localeCompare(b.sourceToTarget))) {
      addItems.push({ label: `$(add) ${t.sourceToTarget}`, verb: t.sourceToTarget });
      if (t.directed && t.targetToSource && t.targetToSource !== t.sourceToTarget) {
        addItems.push({ label: `$(add) ${t.targetToSource}`, verb: t.targetToSource });
      }
    }

    const items: Item[] = [];
    if (existing.length) {
      items.push({ label: 'Existing links', kind: vscode.QuickPickItemKind.Separator } as any, ...existing);
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator } as any);
    }
    items.push({ label: 'Add new link', kind: vscode.QuickPickItemKind.Separator } as any, ...addItems);

    const picked = await vscode.window.showQuickPick<Item>(items, {
      title: `Links on ${issueId}`,
      placeHolder: 'Pick a link to add or remove',
      matchOnDescription: true,
    });
    if (!picked) return;

    if (picked.remove) {
      await client.runCommand([issueId], `remove ${picked.remove.verb} ${picked.remove.target}`);
      cache.invalidateIssue(issueId);
      vscode.window.showInformationMessage(`YouTrack: removed "${picked.remove.verb} ${picked.remove.target}"`);
      return;
    }

    if (picked.verb) {
      const target = await vscode.window.showInputBox({
        title: `Add link: ${picked.verb}`,
        prompt: 'Target issue ID (e.g. ABC-123)',
        validateInput: (v) => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(v.trim()) ? undefined : 'Expected a YouTrack issue ID like ABC-123',
      });
      if (!target) return;
      await client.runCommand([issueId], `${picked.verb} ${target.trim()}`);
      cache.invalidateIssue(issueId);
      vscode.window.showInformationMessage(`YouTrack: ${issueId} ${picked.verb} ${target.trim()}`);
    }
  } catch (e) {
    showYouTrackError(e, 'manage links');
  }
}
