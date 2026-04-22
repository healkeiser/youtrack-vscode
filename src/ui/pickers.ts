import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { User } from '../client/types';
import { colorDotUri } from './colorDot';
import { primeUserAvatars, userAvatarUri } from './userAvatar';

// Shared QuickPick helpers so the Issue Detail panel and the Create Issue
// panel show the same widgets (colored dots, avatars, separators, full
// name + dim login).

export async function pickProject(
  client: YouTrackClient,
): Promise<{ id: string; shortName: string; name: string } | undefined> {
  const projects = await client.listProjects();
  projects.sort((a, b) => a.shortName.localeCompare(b.shortName));
  type Item = vscode.QuickPickItem & { project?: typeof projects[number] };
  const items: Item[] = projects.map((p) => ({
    label: p.shortName,
    description: p.name,
    project: p,
  }));
  const picked = await vscode.window.showQuickPick<Item>(items, {
    title: 'Project',
    placeHolder: 'Pick a project',
    matchOnDescription: true,
  });
  return picked?.project;
}

export async function pickFieldValue(
  client: YouTrackClient,
  projectId: string,
  fieldName: string,
  opts?: { allowClear?: boolean; clearLabel?: string; title?: string; currentValue?: string | null },
): Promise<{ name: string | null } | undefined> {
  const values = await client.fetchProjectFieldValuesDetailed(projectId, fieldName);
  if (!values.length) {
    vscode.window.showWarningMessage(`YouTrack: no values configured for ${fieldName} in this project.`);
    return undefined;
  }
  type Item = vscode.QuickPickItem & { name?: string | null; clear?: true };
  const items: Item[] = [];
  if (opts?.allowClear) {
    items.push({ label: `$(circle-slash) ${opts.clearLabel ?? `Clear ${fieldName}`}`, clear: true });
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator } as any);
  }
  for (const v of values) {
    items.push({ label: v.name, name: v.name, iconPath: colorDotUri(v.color?.background) });
  }
  const picked = await vscode.window.showQuickPick<Item>(items, {
    title: opts?.title ?? `Pick ${fieldName}`,
    placeHolder: opts?.currentValue ? `Current: ${opts.currentValue}` : fieldName,
  });
  if (!picked) return undefined;
  if (picked.clear) return { name: null };
  return { name: picked.name ?? null };
}

export async function pickUser(
  client: YouTrackClient,
  title: string,
  opts?: { allowClear?: boolean; clearLabel?: string; currentValue?: string | null },
): Promise<{ login: string | null; fullName?: string } | undefined> {
  const users = await client.listUsers('', 200).catch(() => [] as User[]);
  await primeUserAvatars(users.map((u) => u.avatarUrl));
  type Item = vscode.QuickPickItem & { login?: string | null; fullName?: string; clear?: true };
  const items: Item[] = [];
  if (opts?.allowClear) {
    items.push({ label: `$(circle-slash) ${opts.clearLabel ?? 'Unassign'}`, login: null, clear: true });
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator } as any);
  }
  for (const u of users) {
    items.push({
      label: u.fullName || u.login,
      description: u.login,
      login: u.login,
      fullName: u.fullName,
      iconPath: userAvatarUri(u.avatarUrl) ?? new vscode.ThemeIcon('person'),
    });
  }
  const picked = await vscode.window.showQuickPick<Item>(items, {
    title,
    placeHolder: opts?.currentValue ? `Current: ${opts.currentValue}` : 'Pick a user',
    matchOnDescription: true,
  });
  if (!picked) return undefined;
  if (picked.clear) return { login: null };
  return { login: picked.login ?? null, fullName: picked.fullName };
}
