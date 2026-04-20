import * as vscode from 'vscode';

interface RecentEntry {
  id: string;
  summary: string;
  openedAt: number;
}

const STORAGE_KEY = 'youtrack.recentIssues';
const MAX_RECENTS = 20;

export class RecentsTreeProvider implements vscode.TreeDataProvider<RecentEntry> {
  private _emitter = new vscode.EventEmitter<RecentEntry | undefined>();
  onDidChangeTreeData = this._emitter.event;

  constructor(private context: vscode.ExtensionContext) {}

  private read(): RecentEntry[] {
    return this.context.globalState.get<RecentEntry[]>(STORAGE_KEY, []);
  }

  private async write(list: RecentEntry[]): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, list);
    this._emitter.fire(undefined);
  }

  async touch(id: string, summary: string): Promise<void> {
    const current = this.read().filter((e) => e.id !== id);
    current.unshift({ id, summary, openedAt: Date.now() });
    await this.write(current.slice(0, MAX_RECENTS));
  }

  async clear(): Promise<void> {
    await this.write([]);
  }

  getChildren(): RecentEntry[] {
    return this.read();
  }

  getTreeItem(entry: RecentEntry): vscode.TreeItem {
    const t = new vscode.TreeItem(`${entry.id}  ${entry.summary}`, vscode.TreeItemCollapsibleState.None);
    t.iconPath = new vscode.ThemeIcon('history');
    t.description = relativeTime(entry.openedAt);
    t.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [entry.id] };
    t.contextValue = 'issue';
    t.tooltip = `${entry.id} — ${entry.summary}`;
    return t;
  }
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
