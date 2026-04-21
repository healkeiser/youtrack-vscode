import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function getNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Fills the shared `{{CSP_SOURCE}}`, `{{NONCE}}`, `{{CODICONS}}`,
// `{{SHARED}}`, `{{MD_EDITOR}}`, `{{STYLE}}` and `{{MAIN}}` slots for a
// webview panel whose assets live under `media/<panelName>/`. Returns
// the patched HTML ready to assign to `panel.webview.html`.
export function renderPanelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  panelName: string,
): string {
  const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
  const panelUri = vscode.Uri.joinPath(mediaRoot, panelName);
  const tpl = fs.readFileSync(path.join(panelUri.fsPath, 'index.html'), 'utf-8');
  const nonce = getNonce();
  const asWebview = (uri: vscode.Uri) => webview.asWebviewUri(uri).toString();
  return tpl
    .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace('{{CODICONS}}', asWebview(vscode.Uri.joinPath(mediaRoot, 'codicons', 'codicon.css')))
    .replace('{{SHARED}}', asWebview(vscode.Uri.joinPath(mediaRoot, 'shared.css')))
    .replace('{{MD_EDITOR}}', asWebview(vscode.Uri.joinPath(mediaRoot, 'mdEditor.js')))
    .replace('{{STYLE}}', asWebview(vscode.Uri.joinPath(panelUri, 'style.css')))
    .replace('{{MAIN}}', asWebview(vscode.Uri.joinPath(panelUri, 'main.js')));
}
