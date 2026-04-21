import * as vscode from 'vscode';
import { HttpError } from './request';

// Parse YouTrack's JSON error body when the server returned one. YouTrack
// uses `{error, error_description, error_developer_message}` consistently
// across its REST endpoints.
interface YouTrackError {
  error?: string;
  error_description?: string;
  error_developer_message?: string;
}

function parseYouTrackBody(body: string): YouTrackError | null {
  try {
    const obj = JSON.parse(body);
    if (obj && typeof obj === 'object') return obj as YouTrackError;
    return null;
  } catch {
    return null;
  }
}

// Normalize any error raised by the YouTrack client into a single-line
// human-readable string. `verb` is what the caller was trying to do,
// e.g. "add comment", "update field", "create issue" — used as the
// fallback prefix. Special-cases:
//   - server-wide read-only mode → one short maintenance notice
//   - auth failures (401/403)    → point the user at the sign-in flow
//   - 404                        → "Not found" without the URL blob
//   - any other HttpError with a parseable YouTrack body → the
//     server's own error_description
//   - plain Error                → ${verb} failed: ${message}
export function formatYouTrackError(err: unknown, verb: string): string {
  if (err instanceof HttpError) {
    const body = parseYouTrackBody(err.body);
    if (body && isReadOnly(body)) return readOnlyNotice();
    if (err.status === 401 || err.status === 403) {
      return body?.error_description
        ? `YouTrack auth failed: ${body.error_description}`
        : `YouTrack auth failed. Run "YouTrack: Sign In" to refresh your token.`;
    }
    if (err.status === 404) {
      return body?.error_description
        ? `YouTrack: ${body.error_description}`
        : `YouTrack: not found.`;
    }
    if (body?.error_description) return `YouTrack: ${body.error_description}`;
    return `YouTrack: ${verb} failed (HTTP ${err.status}).`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Fall-through for errors surfaced *before* they hit HttpError — the
  // caller may have already stringified the HTTP 418 body. Check the
  // raw string for the read-only signature.
  if (isReadOnlyString(msg)) return readOnlyNotice();
  return `YouTrack: ${verb} failed: ${msg}`;
}

function isReadOnly(body: YouTrackError): boolean {
  if (body.error === 'invalid_state') return true;
  const desc = (body.error_description || '').toLowerCase();
  const dev = (body.error_developer_message || '').toLowerCase();
  return desc.includes('read-only') || dev.includes('read-only');
}

function isReadOnlyString(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes('read-only mode') || lower.includes('"invalid_state"');
}

function readOnlyNotice(): string {
  return 'YouTrack is temporarily in read-only mode (maintenance). Writes will resume shortly — try again in a few minutes.';
}

// Parallel writes (e.g. createIssue firing setEnumField × 3 + assign)
// failing during a read-only window would each pop their own toast. A
// short coalescing window keeps the user seeing one notice per burst.
let lastReadOnlyToast = 0;
const READ_ONLY_TOAST_DEDUPE_MS = 8000;

// Convenience wrapper used by every catch site. Chooses showError vs
// showWarning by severity, and coalesces repeated read-only toasts.
export function showYouTrackError(
  err: unknown,
  verb: string,
  level: 'error' | 'warning' = 'error',
): void {
  const msg = formatYouTrackError(err, verb);
  if (msg === readOnlyNotice()) {
    const now = Date.now();
    if (now - lastReadOnlyToast < READ_ONLY_TOAST_DEDUPE_MS) return;
    lastReadOnlyToast = now;
    // Read-only isn't actionable — warning is the right severity.
    vscode.window.showWarningMessage(msg);
    return;
  }
  if (level === 'warning') vscode.window.showWarningMessage(msg);
  else vscode.window.showErrorMessage(msg);
}
