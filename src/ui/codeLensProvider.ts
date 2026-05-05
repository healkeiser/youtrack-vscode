import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

// Match "TODO", "FIXME", "XXX", "HACK", "NOTE" followed by whitespace or
// punctuation, then an issue key. We capture the key's range so the lens
// anchors to it. Keys alone (without a preceding TODO-ish marker) still
// get hover, but not a lens — the lens is specifically for action items
// callers have parked in code.
const LENS_LINE_RE = /\b(?:TODO|FIXME|XXX|HACK|NOTE)\b[^\n]*?\b([A-Z][A-Z0-9_]+-\d+)\b/g;

export class IssueCodeLensProvider implements vscode.CodeLensProvider {
  private onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onChange.event;

  constructor(private client: YouTrackClient, private cache: Cache) {}

  refresh(): void { this.onChange.fire(); }

  async provideCodeLenses(
    doc: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    const text = doc.getText();
    const aiEnabled = vscode.workspace.getConfiguration('youtrack.ai').get<boolean>('enabled', false);
    const lenses: vscode.CodeLens[] = [];
    for (const m of text.matchAll(LENS_LINE_RE)) {
      const id = m[1];
      const start = m.index! + m[0].indexOf(id);
      const range = new vscode.Range(doc.positionAt(start), doc.positionAt(start + id.length));
      // The first lens is the resolved "open in panel" entry; we leave it
      // with the spinner placeholder so resolveCodeLens() can fetch the
      // issue lazily. The AI lens needs no async resolution, so we wire
      // it up directly here.
      lenses.push(new vscode.CodeLens(range, { title: `$(loading~spin) ${id}`, command: '' }));
      if (aiEnabled) {
        lenses.push(new vscode.CodeLens(range, {
          title: '$(sparkle) Ask Claude',
          command: 'youtrack.ai.discussInTerminal',
          arguments: [id],
          tooltip: `Discuss ${id} in a Claude Code terminal`,
        }));
      }
    }
    return lenses;
  }

  async resolveCodeLens(
    lens: vscode.CodeLens,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens> {
    const id = lens.command?.title.replace(/^[^\s]+\s/, '') ?? '';
    try {
      const issue = await this.cache.getIssue(id, (i) => this.client.fetchIssue(i));
      const state = issue.customFields.find((f) => f.name === 'State');
      const stateName = state?.value.kind === 'state' || state?.value.kind === 'enum' ? state.value.name : '';
      const resolved = issue.resolved ? ' · resolved' : '';
      const summary = issue.summary.length > 50 ? issue.summary.slice(0, 50) + '…' : issue.summary;
      lens.command = {
        title: stateName ? `${id} · ${stateName}${resolved} · ${summary}` : `${id} · ${summary}`,
        command: 'youtrack.openIssue',
        arguments: [id],
        tooltip: 'Open in YouTrack panel',
      };
    } catch {
      lens.command = {
        title: `${id} · (not found)`,
        command: 'youtrack.openIssue',
        arguments: [id],
      };
    }
    return lens;
  }
}
