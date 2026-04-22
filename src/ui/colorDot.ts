import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// QuickPickItem.iconPath renders any Uri-based image; ThemeIcon color is
// ignored by the widget, and emoji look out of place. So we write a tiny
// 16×16 SVG with a circle filled at the exact YouTrack hex, cache it on
// disk under globalStorage, and hand the file Uri back to the picker.

let storageDir: string | undefined;
const memo = new Set<string>();

export function initColorDots(context: vscode.ExtensionContext): void {
  storageDir = path.join(context.globalStorageUri.fsPath, 'color-dots');
  try { fs.mkdirSync(storageDir, { recursive: true }); }
  catch { /* swallow — colorDotUri falls back to undefined */ }
  pruneStale(storageDir);
}

// Drop cached files that haven't been used in 30 days. Runs once per
// activation — cheap enough to skip debouncing.
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

export function colorDotUri(hex: string | undefined | null): vscode.Uri | undefined {
  if (!hex || !storageDir) return undefined;
  const safe = hex.replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(safe)) return undefined;
  const file = path.join(storageDir, `${safe}.svg`);
  if (!memo.has(safe)) {
    try {
      if (!fs.existsSync(file)) {
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
          `<circle cx="8" cy="8" r="5" fill="#${safe}"/></svg>`;
        fs.writeFileSync(file, svg, 'utf8');
      }
      memo.add(safe);
    } catch {
      return undefined;
    }
  }
  return vscode.Uri.file(file);
}
