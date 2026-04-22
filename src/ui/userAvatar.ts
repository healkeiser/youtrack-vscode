import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { YouTrackClient } from '../client/youtrackClient';

// QuickPickItem.iconPath only renders local file Uris (remote URLs don't
// load). So we download each unique YouTrack avatar once, cache it under
// <globalStorage>/avatars/ keyed by SHA-1 of the URL, and hand the file
// Uri back to the picker. primeUserAvatars() should be awaited after a
// listUsers() call so the picker that follows can render every avatar on
// first open.

let storageDir: string | undefined;
let client: YouTrackClient | undefined;
const memoOk = new Set<string>();   // urls we've successfully cached
const memoBad = new Set<string>();  // urls that failed; skip next time

export function initUserAvatars(context: vscode.ExtensionContext, c: YouTrackClient): void {
  storageDir = path.join(context.globalStorageUri.fsPath, 'avatars');
  client = c;
  try { fs.mkdirSync(storageDir, { recursive: true }); }
  catch { /* swallow — userAvatarUri falls back to undefined */ }
  pruneStale(storageDir);
}

// Drop cached avatars that haven't been used in 30 days.
function pruneStale(dir: string): void {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.atimeMs < cutoff) fs.unlinkSync(p);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function cachePath(url: string): string | undefined {
  if (!storageDir) return undefined;
  const extMatch = url.match(/\.(png|jpe?g|gif|webp)(?:\?|#|$)/i);
  const ext = (extMatch?.[1] ?? 'png').toLowerCase();
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  return path.join(storageDir, `${hash}.${ext}`);
}

export function userAvatarUri(url: string | undefined | null): vscode.Uri | undefined {
  if (!url) return undefined;
  const file = cachePath(url);
  if (!file) return undefined;
  try {
    if (fs.existsSync(file)) return vscode.Uri.file(file);
  } catch { /* ignore */ }
  return undefined;
}

export async function primeUserAvatars(urls: Array<string | undefined | null>): Promise<void> {
  if (!storageDir || !client) return;
  const todo = Array.from(new Set(urls.filter((u): u is string => !!u)))
    .filter((u) => !memoOk.has(u) && !memoBad.has(u));
  await Promise.all(todo.map(async (url) => {
    try {
      const file = cachePath(url);
      if (!file) return;
      if (fs.existsSync(file)) { memoOk.add(url); return; }
      const bytes = await client!.downloadBytes(url);
      fs.writeFileSync(file, bytes);
      memoOk.add(url);
    } catch {
      memoBad.add(url);
    }
  }));
}
