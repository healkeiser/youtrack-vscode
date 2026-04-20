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
    this.item.show();
  }

  async refresh(): Promise<void> {
    const query = vscode.workspace.getConfiguration('youtrack').get<string>('statusBarQuery', 'for: me and #Unresolved');
    try {
      this.issues = await this.client.searchIssues(query, 0, 100);
      this.item.text = `$(check) ${this.issues.length}`;
      this.item.tooltip = `YouTrack: ${this.issues.length} issues matching "${query}"`;
    } catch (e) {
      this.item.text = '$(alert) YouTrack';
      this.item.tooltip = `YouTrack: ${(e as Error).message}`;
    }
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  async click(): Promise<void> {
    if (!this.issues.length) { await this.refresh(); }
    const picked = await vscode.window.showQuickPick(
      this.issues.map((i) => ({ label: i.idReadable, description: i.summary })),
      { placeHolder: 'Your issues', ignoreFocusOut: true },
    );
    if (picked) vscode.commands.executeCommand('youtrack.openIssue', picked.label);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
