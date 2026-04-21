import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { CreateIssuePanel } from '../ui/createIssuePanel';

// Right-click in an editor, pick "YouTrack: Create Issue from Selection".
// Opens the Create Issue panel with:
//   summary  = "<fileBasename>:<startLine>-<endLine> — …"
//   desc     = a markdown code block fenced with the file's language id,
//              preceded by a link back to the file (relative to the
//              workspace root) so the ticket points clickable users at
//              the exact snippet.
export function createIssueFromSelection(
  extensionUri: vscode.Uri,
  client: YouTrackClient,
  onCreated?: (id: string) => void,
): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('YouTrack: open a file and select some code first.');
    return;
  }
  const sel = editor.selection;
  if (sel.isEmpty) {
    vscode.window.showWarningMessage('YouTrack: nothing selected.');
    return;
  }

  const doc = editor.document;
  const snippet = doc.getText(sel);
  const startLine = sel.start.line + 1;
  const endLine = sel.end.line + 1;
  const langId = doc.languageId || '';
  const basename = doc.fileName.replace(/\\/g, '/').split('/').pop() || 'selection';
  const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const relPath = wsFolder ? vscode.workspace.asRelativePath(doc.uri, false) : basename;

  const firstLineOfSnippet = snippet.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const summaryTail = firstLineOfSnippet.length > 60
    ? firstLineOfSnippet.slice(0, 60) + '…'
    : firstLineOfSnippet;
  const summary = `${basename}:${startLine}${startLine === endLine ? '' : `-${endLine}`}${summaryTail ? ` — ${summaryTail}` : ''}`;

  const lineSuffix = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
  const description = [
    `From \`${relPath}\` (${lineSuffix}):`,
    '',
    '```' + langId,
    snippet,
    '```',
  ].join('\n');

  CreateIssuePanel.show(extensionUri, client, onCreated, { summary, description });
}
