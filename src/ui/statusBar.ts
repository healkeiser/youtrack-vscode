import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Issue } from '../client/types';

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private issues: Issue[] = [];

  constructor(private client: YouTrackClient, private intervalMs: number) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'youtrack.statusBarClick';
    this.item.name = 'YouTrack';
    this.item.show();
  }

  async refresh(): Promise<void> {
    const query = vscode.workspace.getConfiguration('youtrack').get<string>('statusBarQuery', 'for: me and #Unresolved');
    try {
      this.issues = await this.client.searchIssues(query, 0, 100);
      this.item.text = `$(tasklist) YouTrack · ${this.issues.length}`;
      const tip = new vscode.MarkdownString();
      tip.isTrusted = true;
      tip.supportThemeIcons = true;
      tip.appendMarkdown(`**YouTrack** — ${this.issues.length} issues matching \`${query}\`\n\n`);
      const preview = this.issues.slice(0, 8);
      for (const i of preview) {
        tip.appendMarkdown(`- \`${i.idReadable}\` ${i.summary.replace(/\|/g, '\\|')}\n`);
      }
      if (this.issues.length > preview.length) {
        tip.appendMarkdown(`\n_…and ${this.issues.length - preview.length} more_\n`);
      }
      tip.appendMarkdown(`\n[$(add) Create] · [$(search) Search] · [$(list-unordered) Your issues] · [$(sync) Refresh](command:youtrack.refresh)`);
      this.item.tooltip = tip;
    } catch (e) {
      this.item.text = '$(alert) YouTrack';
      const tip = new vscode.MarkdownString();
      tip.appendMarkdown(`**YouTrack error**\n\n${(e as Error).message}`);
      this.item.tooltip = tip;
    }
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  async click(): Promise<void> {
    if (!this.issues.length) { await this.refresh(); }

    type Item = vscode.QuickPickItem & { action: () => void };
    const actions: Item[] = [
      { label: '$(add) New issue…', description: 'Create a new issue', action: () => vscode.commands.executeCommand('youtrack.createIssue') },
      { label: '$(search) Search…', description: 'Find an issue by query', action: () => vscode.commands.executeCommand('youtrack.search') },
      { label: '$(arrow-right) Go to issue…', description: 'Open by ID', action: () => vscode.commands.executeCommand('youtrack.goToIssue') },
      { label: '$(project) Open agile board…', description: 'Pick a sprint and open it', action: () => vscode.commands.executeCommand('youtrack.openBoard') },
      { label: '$(sync) Refresh sidebar', action: () => vscode.commands.executeCommand('youtrack.refresh') },
    ];

    const issueItems: Item[] = this.issues.map((i) => ({
      label: i.idReadable,
      description: i.summary,
      action: () => vscode.commands.executeCommand('youtrack.openIssue', i.idReadable),
    }));

    const picked = await vscode.window.showQuickPick(
      [
        ...actions,
        { label: `Your issues (${this.issues.length})`, kind: vscode.QuickPickItemKind.Separator, action: () => {} },
        ...issueItems,
      ],
      { placeHolder: 'YouTrack', matchOnDescription: true, ignoreFocusOut: true },
    );
    picked?.action();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
