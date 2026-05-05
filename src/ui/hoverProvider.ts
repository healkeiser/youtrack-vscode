import * as vscode from 'vscode';
import { joinUrl, type YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

const ISSUE_KEY_REGEX = /\b[A-Z][A-Z0-9_]+-\d+\b/g;

export class IssueHoverProvider implements vscode.HoverProvider {
  constructor(private client: YouTrackClient, private cache: Cache, private baseUrl: string) {}

  async provideHover(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const range = doc.getWordRangeAtPosition(pos, ISSUE_KEY_REGEX);
    if (!range) return undefined;
    const id = doc.getText(range);

    let issue;
    try {
      issue = await this.cache.getIssue(id, (i) => this.client.fetchIssue(i));
    } catch {
      return undefined;
    }

    const state = issue.customFields.find((f) => f.name === 'State');
    const stateName = state?.value.kind === 'state' || state?.value.kind === 'enum' ? state.value.name : '';
    const assignee = issue.assignee?.fullName ?? issue.assignee?.login ?? 'Unassigned';
    const webUrl = joinUrl(this.baseUrl, `/issue/${id}`);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;
    md.appendMarkdown(`**[${issue.idReadable}](${webUrl})** — ${escapeMd(issue.summary)}\n\n`);
    if (stateName) md.appendMarkdown(`**State:** ${escapeMd(stateName)}  \n`);
    md.appendMarkdown(`**Assignee:** ${escapeMd(assignee)}\n\n`);
    md.appendMarkdown(
      `[$(eye) Open](command:youtrack.openIssue?${encodeURIComponent(JSON.stringify([id]))})`
      + `  ·  [$(browser) Web](${webUrl})`,
    );
    return new vscode.Hover(md, range);
  }
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}\[\]()#+\-.!])/g, '\\$1');
}
