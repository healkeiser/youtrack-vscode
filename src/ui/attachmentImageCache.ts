import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { YouTrackClient } from '../client/youtrackClient';

let log: vscode.OutputChannel | undefined;
let warnedThisSession = false;

// YouTrack attachment URLs require authentication: they include a
// signature query param, but the VS Code webview's request origin is
// `vscode-webview://<id>` and YouTrack rejects the load. Even when it
// doesn't, the signed URL ages out within minutes. So instead of
// pointing the <img> tags directly at YouTrack we download each image
// once with the Bearer token, cache it under the extension's
// globalStorage, and hand the webview a local file URI it CAN load.
//
// Mirrors src/ui/userAvatar.ts — same hashing, same prune cadence.

// We keep both the URI (for vscode.Uri.joinPath / asWebviewUri — the
// webview-resource gateway prefix-matches against this exact value)
// and the fsPath (for cheap fs operations). Building child URIs via
// path.join + vscode.Uri.file would silently desynchronize on Windows
// when the drive-letter case differs, which causes 401s from the
// webview gateway even though the file exists on disk.
let storageUri: vscode.Uri | undefined;
let storageDir: string | undefined;
let client: YouTrackClient | undefined;
const memoOk = new Set<string>();   // urls we've successfully cached
const memoBad = new Set<string>();  // urls that failed; skip next time
const inflight = new Map<string, Promise<void>>();

export function initAttachmentImageCache(context: vscode.ExtensionContext, c: YouTrackClient): void {
  storageUri = vscode.Uri.joinPath(context.globalStorageUri, 'attachments');
  storageDir = storageUri.fsPath;
  client = c;
  try {
    fs.mkdirSync(storageDir, { recursive: true });
    fs.statSync(storageDir);
  } catch (e) {
    getLog().appendLine(`[attachments] could not create cache dir ${storageDir}: ${(e as Error).message}`);
    storageUri = undefined;
    storageDir = undefined;
    return;
  }
  getLog().appendLine(`[attachments] cache dir: ${storageDir}`);
  pruneStale(storageDir);
}

function getLog(): vscode.OutputChannel {
  if (!log) log = vscode.window.createOutputChannel('YouTrack');
  return log;
}

export function showAttachmentLog(): void {
  getLog().show();
}

function pruneStale(dir: string): void {
  // Drop cached attachments not used in 7 days. Attachments tend to be
  // larger than avatars (full-resolution screenshots / images), so we
  // keep them around for less time.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
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

// Quick magic-byte sniff. Doesn't need to be exhaustive — just enough
// to catch files that obviously aren't images (e.g. HTML login pages
// that got cached under a .png name).
function fileLooksLikeImage(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(12);
      const n = fs.readSync(fd, buf, 0, 12, 0);
      if (n < 4) return false;
      // PNG, JPEG, GIF, WebP, BMP, SVG (heuristic)
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
      if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
      if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
      if (buf[0] === 0x42 && buf[1] === 0x4d) return true; // BMP
      if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true; // WebP
      const head = buf.slice(0, n).toString('utf-8');
      if (/^\s*<\?xml|^\s*<svg/i.test(head)) return true; // SVG
      return false;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function cacheFilename(url: string): string | undefined {
  const extMatch = url.match(/\.(png|jpe?g|gif|webp|bmp|svg)(?:\?|#|$)/i);
  const ext = (extMatch?.[1] ?? 'png').toLowerCase();
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  return `${hash}.${ext}`;
}

function cachePath(url: string): string | undefined {
  if (!storageDir) return undefined;
  const name = cacheFilename(url);
  return name ? path.join(storageDir, name) : undefined;
}

// Returns a webview-loadable URI for an attachment URL if it's already
// in the cache; otherwise undefined. We derive the URI via
// vscode.Uri.joinPath against the same `storageUri` we registered as a
// localResourceRoot — that guarantees the scheme/authority/casing
// match what the webview-resource gateway is prefix-matching against,
// avoiding mysterious 401s on Windows where vscode.Uri.file(...) may
// produce a path with different drive-letter casing than the registered
// root.
export function cachedAttachmentUri(url: string | undefined | null): vscode.Uri | undefined {
  if (!url || !storageUri) return undefined;
  const name = cacheFilename(url);
  if (!name) return undefined;
  const filePath = path.join(storageDir!, name);
  try {
    if (fs.existsSync(filePath)) return vscode.Uri.joinPath(storageUri, name);
  } catch { /* ignore */ }
  return undefined;
}

// Downloads (with auth) any URLs not already cached. Safe to call with
// a mix of seen and unseen URLs; we de-dup, skip known-bad ones, and
// share concurrent requests for the same URL.
export async function primeAttachmentImages(urls: Array<string | undefined | null>): Promise<void> {
  if (!storageDir || !client) return;
  const todo = Array.from(new Set(urls.filter((u): u is string => !!u)))
    .filter((u) => !memoOk.has(u) && !memoBad.has(u));
  await Promise.all(todo.map((url) => downloadOne(url)));
}

function downloadOne(url: string): Promise<void> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = (async () => {
    try {
      const file = cachePath(url);
      if (!file) {
        getLog().appendLine(`[attachments] no cache path for ${redact(url)} (storageDir=${storageDir ?? 'unset'})`);
        return;
      }
      if (fs.existsSync(file)) {
        // Sanity-check existing files: if a previous run wrote an HTML
        // login page under a .jpg name, we want to redownload now that
        // auth handling is fixed instead of serving the broken file.
        if (fileLooksLikeImage(file)) { memoOk.add(url); return; }
        getLog().appendLine(`[attachments] re-downloading ${redact(url)} (cached file isn't a recognizable image)`);
        try { fs.unlinkSync(file); } catch { /* ignore */ }
      }
      const bytes = await client!.downloadBytes(url, { expectContentType: /^image\/|^application\/(?:octet-stream|x-empty)/i });
      fs.writeFileSync(file, bytes);
      memoOk.add(url);
      getLog().appendLine(`[attachments] cached ${redact(url)} → ${file} (${bytes.byteLength} bytes)`);
    } catch (e) {
      memoBad.add(url);
      const msg = e instanceof Error ? e.message : String(e);
      getLog().appendLine(`[attachments] FAILED ${redact(url)}: ${msg}`);
      maybeWarnUserOnce(msg);
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

// One-shot toast so the user finds out something is broken without us
// spamming on every render. Subsequent failures keep flowing into the
// output channel only.
function maybeWarnUserOnce(message: string): void {
  if (warnedThisSession) return;
  warnedThisSession = true;
  vscode.window.showWarningMessage(
    `YouTrack: failed to download attachment images (${message}). Open the YouTrack output channel for details.`,
    'Open Output',
  ).then((pick) => {
    if (pick === 'Open Output') showAttachmentLog();
  });
}

// Strip the `signature=` query parameter so we never log a token in
// plain text.
function redact(url: string): string {
  return url.replace(/([?&])(sign|signature|token)=[^&]*/gi, '$1$2=<redacted>');
}
