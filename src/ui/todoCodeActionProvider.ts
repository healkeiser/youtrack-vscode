import * as vscode from 'vscode';

// Markers that earn a Quick Fix. Same set the CodeLens provider scans
// for, but we only fire when the line has NO issue id — once an id is
// attached, the lens takes over.
const MARKER_RE = /\b(TODO|FIXME|XXX|HACK|NOTE)\b/;
const ISSUE_ID_RE = /\b[A-Z][A-Z0-9_]+-\d+\b/;

export interface TodoCommandPayload {
  uri: vscode.Uri;
  /** Range of the marker word itself (e.g. just "TODO"). */
  markerRange: vscode.Range;
  /** Range of the whole comment line. */
  lineRange: vscode.Range;
  marker: string;
  /** Comment text after the marker, on the same line, with leading punctuation stripped. */
  text: string;
  /** Whole line text, untouched. */
  rawLine: string;
}

export class TodoCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    doc: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] | undefined {
    const aiEnabled = vscode.workspace.getConfiguration('youtrack.ai').get<boolean>('enabled', false);
    if (!aiEnabled) return undefined;

    // Inspect the line the cursor / selection touches. We deliberately
    // ignore multi-line selections — TODO markers are line-scoped.
    const line = doc.lineAt(range.start.line);
    const m = MARKER_RE.exec(line.text);
    if (!m) return undefined;
    if (ISSUE_ID_RE.test(line.text)) return undefined;

    const markerStart = m.index;
    const markerEnd = markerStart + m[0].length;
    const markerRange = new vscode.Range(line.lineNumber, markerStart, line.lineNumber, markerEnd);

    const payload: TodoCommandPayload = {
      uri: doc.uri,
      markerRange,
      lineRange: line.range,
      marker: m[0],
      text: extractTodoText(line.text, markerEnd),
      rawLine: line.text,
    };

    const action = new vscode.CodeAction(
      `Create YouTrack issue from this ${m[0]}`,
      vscode.CodeActionKind.QuickFix,
    );
    action.command = {
      title: action.title,
      command: 'youtrack.ai.createIssueFromTodo',
      arguments: [payload],
    };
    action.isPreferred = true;
    return [action];
  }
}

// "TODO: foo bar" → "foo bar". Tolerates ":" / "-" / "—" / "(...)" /
// trailing whitespace right after the marker. Anything we can't parse
// just falls through as the rest of the line.
function extractTodoText(lineText: string, markerEnd: number): string {
  let s = lineText.slice(markerEnd);
  // Strip optional parenthesized author/scope: "TODO(alice): foo"
  s = s.replace(/^\s*\([^)]*\)/, '');
  s = s.replace(/^\s*[:\-—]?\s*/, '');
  return s.trim();
}
