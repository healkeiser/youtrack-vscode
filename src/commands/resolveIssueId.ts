import * as vscode from 'vscode';

export async function resolveIssueId(arg: unknown): Promise<string | undefined> {
  if (typeof arg === 'string' && arg.length) return arg;
  if (arg && typeof arg === 'object') {
    const any = arg as { issue?: { idReadable?: string }; idReadable?: string };
    if (any.issue?.idReadable) return any.issue.idReadable;
    if (any.idReadable) return any.idReadable;
  }
  return vscode.window.showInputBox({
    prompt: 'Issue ID',
    placeHolder: 'FOO-123',
    ignoreFocusOut: true,
  });
}
