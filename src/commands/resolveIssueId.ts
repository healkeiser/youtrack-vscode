import * as vscode from 'vscode';

const ISSUE_KEY = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

export async function resolveIssueId(arg: unknown): Promise<string | undefined> {
  if (typeof arg === 'string' && arg.length) return arg;
  if (arg && typeof arg === 'object') {
    const any = arg as { issue?: { idReadable?: string }; idReadable?: string };
    if (any.issue?.idReadable) return any.issue.idReadable;
    if (any.idReadable) return any.idReadable;
  }
  // Fallback chain: current git branch → editor cursor → prompt.
  const fromBranch = tryBranchIssueKey();
  const fromCursor = tryCursorIssueKey();
  const suggestion = fromBranch ?? fromCursor;
  return vscode.window.showInputBox({
    prompt: 'Issue ID',
    placeHolder: 'FOO-123',
    value: suggestion,
    valueSelection: suggestion ? [0, suggestion.length] : undefined,
    ignoreFocusOut: true,
  });
}

function tryBranchIssueKey(): string | undefined {
  try {
    const gitExt = vscode.extensions.getExtension<any>('vscode.git')?.exports;
    const api = gitExt?.getAPI(1);
    const repo = api?.repositories?.[0];
    const branch: string | undefined = repo?.state?.HEAD?.name;
    const m = branch?.match(ISSUE_KEY);
    return m?.[1];
  } catch { return undefined; }
}

function tryCursorIssueKey(): string | undefined {
  try {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const doc = editor.document;
    if (!editor.selection.isEmpty) {
      const t = doc.getText(editor.selection).trim();
      const m = t.match(ISSUE_KEY);
      if (m) return m[1];
    }
    const range = doc.getWordRangeAtPosition(editor.selection.active, /\b[A-Z][A-Z0-9_]+-\d+\b/);
    return range ? doc.getText(range) : undefined;
  } catch { return undefined; }
}
