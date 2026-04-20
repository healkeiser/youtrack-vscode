import * as vscode from 'vscode';

export class UriHandler implements vscode.UriHandler {
  handleUri(uri: vscode.Uri): void {
    if (uri.authority === 'issue' || uri.path.startsWith('/')) {
      const id = uri.path.replace(/^\/+/, '') || uri.authority;
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
    }
  }
}
