import * as vscode from 'vscode';

export async function goToIssue(): Promise<string | null> {
  const id = await vscode.window.showInputBox({
    prompt: 'Issue ID',
    placeHolder: 'FOO-123',
    validateInput: (v) => (/^[A-Z][A-Z0-9]+-\d+$/.test(v) ? null : 'Format: PROJECT-NUMBER'),
  });
  return id ?? null;
}
