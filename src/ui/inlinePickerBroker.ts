import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { primeUserAvatars } from './userAvatar';
import { stateVisuals } from '../util/stateVisuals';

// Picker item sent to the webview.
export interface InlinePickerItem {
  id: string;                   // key applied back when picked
  label: string;
  description?: string;
  icon?:
    | { kind: 'codicon'; name: string; color?: string }
    | { kind: 'dot'; color?: string }
    | { kind: 'avatar'; src: string };
  picked?: boolean;             // initial state for multi-select
  action?: true;                // top action (e.g. Unassign, Clear, Create)
  separator?: true;
}

// Request shape posted from the webview.
export interface FetchPickerRequest {
  requestId: string;
  kind: 'state' | 'priority' | 'enum' | 'user' | 'project' | 'tags' | 'links' | 'workItemType';
  fieldName?: string;
  projectId?: string;
  allowClear?: boolean;
  clearLabel?: string;
  currentIds?: string[];        // for multi-select (tags)
  existingLinks?: Array<{ verb: string; targetId: string; targetSummary?: string }>;
}

export async function buildPickerItems(
  client: YouTrackClient,
  webview: vscode.Webview,
  req: FetchPickerRequest,
): Promise<{ items: InlinePickerItem[]; actions: InlinePickerItem[] }> {
  const actions: InlinePickerItem[] = [];
  if (req.allowClear) {
    actions.push({
      id: '__clear__',
      label: req.clearLabel ?? `Clear ${req.fieldName ?? 'field'}`,
      icon: { kind: 'codicon', name: 'circle-slash' },
      action: true,
    });
  }

  switch (req.kind) {
    case 'project': {
      const projects = await client.listProjects();
      projects.sort((a, b) => a.shortName.localeCompare(b.shortName));
      return {
        actions,
        items: projects.map<InlinePickerItem>((p) => ({
          id: p.id,
          label: p.shortName,
          description: p.name,
          icon: { kind: 'codicon', name: 'project' },
        })),
      };
    }
    case 'state': {
      if (!req.projectId) return { actions, items: [] };
      const values = await client.fetchProjectFieldValuesDetailed(req.projectId, 'State');
      return {
        actions,
        items: values.map<InlinePickerItem>((v) => {
          // Real YouTrack-configured color wins; otherwise pick the shape
          // suggested by the name so visually similar states still differ.
          const vis = stateVisuals(v.name);
          const icon: InlinePickerItem['icon'] = v.color?.background
            ? { kind: 'codicon', name: vis.icon, color: v.color.background }
            : { kind: 'codicon', name: vis.icon, color: vis.color };
          return {
            id: v.name,
            label: v.name,
            icon,
          };
        }),
      };
    }
    case 'priority':
    case 'enum': {
      if (!req.projectId || !req.fieldName) return { actions, items: [] };
      const values = await client.fetchProjectFieldValuesDetailed(req.projectId, req.fieldName);
      return {
        actions,
        items: values.map<InlinePickerItem>((v) => ({
          id: v.name,
          label: v.name,
          icon: { kind: 'dot', color: v.color?.background },
        })),
      };
    }
    case 'user': {
      const users = await client.listUsers('', 200).catch(() => []);
      // Inside a webview we can load remote HTTPS images directly — the
      // CSP allows `img-src https:` — so skip the local avatar cache
      // (which is meant for native QuickPick that only accepts file:
      // Uris). Keeping the cache priming running is still useful for the
      // palette-invoked pickers.
      void primeUserAvatars(users.map((u) => u.avatarUrl));
      return {
        actions,
        items: users.map<InlinePickerItem>((u) => ({
          id: u.login,
          label: u.fullName || u.login,
          description: u.login,
          icon: u.avatarUrl && /^https?:/i.test(u.avatarUrl)
            ? { kind: 'avatar', src: u.avatarUrl }
            : { kind: 'codicon', name: 'person' },
        })),
      };
    }
    case 'tags': {
      const all = await client.listTags();
      const current = new Set(req.currentIds ?? []);
      actions.push({
        id: '__new_tag__',
        label: 'Create new tag…',
        icon: { kind: 'codicon', name: 'add' },
        action: true,
      });
      return {
        actions,
        items: all
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map<InlinePickerItem>((t) => ({
            id: t.id,
            label: t.name,
            picked: current.has(t.id),
            icon: t.color?.background
              ? { kind: 'dot', color: t.color.background }
              : undefined,
          })),
      };
    }
    case 'links': {
      const types = await client.listIssueLinkTypes();
      const existing = req.existingLinks ?? [];
      const items: InlinePickerItem[] = [];
      for (const link of existing) {
        items.push({
          id: `__remove__${link.verb}|${link.targetId}`,
          label: `${link.verb} ${link.targetId}`,
          description: link.targetSummary ?? '',
          icon: { kind: 'codicon', name: 'trash' },
          action: true,
        });
      }
      if (existing.length) items.push({ id: '__sep__', label: '', separator: true });
      for (const t of types.sort((a, b) => a.sourceToTarget.localeCompare(b.sourceToTarget))) {
        items.push({ id: `__add__${t.sourceToTarget}`, label: t.sourceToTarget, icon: { kind: 'codicon', name: 'add' }, action: true });
        if (t.directed && t.targetToSource && t.targetToSource !== t.sourceToTarget) {
          items.push({ id: `__add__${t.targetToSource}`, label: t.targetToSource, icon: { kind: 'codicon', name: 'add' }, action: true });
        }
      }
      return { actions: [], items };
    }
    case 'workItemType': {
      const types = await client.listWorkItemTypes();
      actions.push({ id: '__clear__', label: '(no type)', icon: { kind: 'codicon', name: 'circle-slash' }, action: true });
      return {
        actions,
        items: types.map<InlinePickerItem>((t) => ({
          id: t.id,
          label: t.name,
          icon: { kind: 'codicon', name: 'clock' },
        })),
      };
    }
  }
}
