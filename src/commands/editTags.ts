import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { Tag } from '../client/types';
import { showYouTrackError } from '../client/errors';

interface TagPickItem extends vscode.QuickPickItem {
  tag?: Tag;
  create?: true;
}

// Multi-select picker that adds/removes tags on a single issue. Fetches all
// visible tags, pre-checks the ones currently attached, and applies the diff
// on accept. A top "Create new tag…" entry drops into an InputBox to create
// and attach a brand new tag without leaving the flow.
export async function editTags(
  client: YouTrackClient,
  cache: Cache,
  issueId: string,
): Promise<boolean> {
  try {
    const issue = await cache.getIssue(issueId, (id) => client.fetchIssue(id));
    const [allTags] = await Promise.all([client.listTags()]);
    const currentIds = new Set(issue.tags.map((t) => t.id));

    const items: TagPickItem[] = [
      { label: '$(add) Create new tag…', description: 'Type a name on the next step', create: true },
      { label: '', kind: vscode.QuickPickItemKind.Separator } as any,
      ...allTags
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map<TagPickItem>((t) => ({
          label: t.name,
          picked: currentIds.has(t.id),
          tag: t,
        })),
    ];

    const picked = await vscode.window.showQuickPick<TagPickItem>(items, {
      title: `Tags for ${issueId}`,
      placeHolder: 'Toggle tags; unselected ones will be removed',
      canPickMany: true,
      matchOnDescription: true,
    });
    if (!picked) return false;

    const wantsNew = picked.some((p) => p.create);
    const keepIds = new Set(picked.filter((p) => p.tag).map((p) => p.tag!.id));
    const toAdd = [...keepIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !keepIds.has(id));

    const ops: Array<Promise<unknown>> = [];
    for (const id of toAdd)    ops.push(client.addTagToIssue(issueId, id));
    for (const id of toRemove) ops.push(client.removeTagFromIssue(issueId, id));
    await Promise.all(ops);

    if (wantsNew) {
      const name = await vscode.window.showInputBox({
        title: 'Create new tag',
        prompt: 'Tag name',
        validateInput: (v) => (v.trim() ? undefined : 'Name required'),
      });
      if (name && name.trim()) {
        const tag = await client.createTag(name.trim());
        await client.addTagToIssue(issueId, tag.id);
      }
    }

    cache.invalidateIssue(issueId);
    return true;
  } catch (e) {
    showYouTrackError(e, 'edit tags');
    return false;
  }
}
