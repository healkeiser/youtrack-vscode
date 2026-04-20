import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

const ISSUE_PATTERN = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

export class CurrentIssueBadge implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private subs: vscode.Disposable[] = [];
  private lastId = '';

  constructor(private client: YouTrackClient, private cache: Cache) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.item.name = 'YouTrack: Current issue';
    this.update();

    const gitExt = vscode.extensions.getExtension<any>('vscode.git');
    const bind = (api: any) => {
      for (const repo of api.repositories ?? []) this.subscribeRepo(repo);
      this.subs.push(api.onDidOpenRepository?.((r: any) => this.subscribeRepo(r)));
    };
    if (gitExt) {
      const p: Promise<any> = gitExt.isActive ? Promise.resolve(gitExt.exports) : Promise.resolve(gitExt.activate());
      p.then((exp: any) => {
        try { bind(exp.getAPI(1)); } catch { /* ignore */ }
      }).catch(() => { /* ignore */ });
    }
  }

  private subscribeRepo(repo: any): void {
    const handler = () => this.update();
    try {
      this.subs.push(repo.state.onDidChange?.(handler));
    } catch { /* noop */ }
    handler();
  }

  private currentBranch(): string | undefined {
    const gitExt = vscode.extensions.getExtension<any>('vscode.git');
    if (!gitExt?.isActive) return undefined;
    try {
      const api = gitExt.exports.getAPI(1);
      const repo = api.repositories?.[0];
      return repo?.state?.HEAD?.name;
    } catch { return undefined; }
  }

  private async update(): Promise<void> {
    const branch = this.currentBranch();
    const match = branch ? ISSUE_PATTERN.exec(branch) : null;
    if (!match) {
      this.lastId = '';
      this.item.hide();
      return;
    }
    const id = match[1];
    if (id === this.lastId) { this.item.show(); return; }
    this.lastId = id;
    this.item.text = `$(tasklist) ${id}`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    this.item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
    this.item.tooltip = new vscode.MarkdownString(`**${id}**  \nLoading summary…`);
    this.item.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [id] };
    this.item.show();
    try {
      const issue = await this.cache.getIssue(id, (x) => this.client.fetchIssue(x));
      // Keep the text short — full title lives in the tooltip.
      this.item.text = `$(tasklist) ${id}`;
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${id}** — ${issue.summary}\n\n`);
      md.appendMarkdown(`Branch: \`${branch}\``);
      this.item.tooltip = md;
    } catch (e) {
      this.item.text = `$(tasklist) ${id}`;
      this.item.tooltip = new vscode.MarkdownString(`**${id}**  \n_could not load summary: ${(e as Error).message}_`);
    }
  }

  dispose(): void {
    for (const s of this.subs) s?.dispose?.();
    this.item.dispose();
  }
}
