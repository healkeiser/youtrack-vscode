import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';

type Notif = Awaited<ReturnType<YouTrackClient['fetchNotifications']>>[number];

export class NotificationsTreeProvider implements vscode.TreeDataProvider<Notif> {
  private _emitter = new vscode.EventEmitter<Notif | undefined>();
  onDidChangeTreeData = this._emitter.event;
  private cache: Notif[] | null = null;

  constructor(private client: YouTrackClient) {}

  refresh(): void {
    this.cache = null;
    this._emitter.fire(undefined);
  }

  async getChildren(el?: Notif): Promise<Notif[]> {
    if (el) return [];
    if (!this.cache) this.cache = await this.client.fetchNotifications(50);
    return this.cache;
  }

  getTreeItem(n: Notif): vscode.TreeItem {
    const label = n.issue ? `${n.issue.idReadable}  ${n.issue.summary}` : 'YouTrack notification';
    const t = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    t.iconPath = new vscode.ThemeIcon(n.read ? 'bell' : 'bell-dot');
    t.description = new Date(n.created).toLocaleString();
    const body = (n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const tooltip = new vscode.MarkdownString();
    if (n.sender) tooltip.appendMarkdown(`**${n.sender.fullName || n.sender.login}**  \n`);
    tooltip.appendMarkdown(body || '_(no body)_');
    t.tooltip = tooltip;
    if (n.issue) {
      t.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [n.issue.idReadable] };
    }
    // contextValue drives view/item/context menus; keep 'issue' when we
    // have a linked issue so the existing open-in-browser menu still
    // works, plus append '.notif' so the mark-read entry also matches.
    t.contextValue = n.issue
      ? (n.read ? 'issue notif.read' : 'issue notif.unread')
      : (n.read ? 'notif.read' : 'notif.unread');
    t.id = `notif:${n.id}`;
    return t;
  }

  unreadIds(): string[] {
    return (this.cache ?? []).filter((n) => !n.read).map((n) => n.id);
  }

  hasUnread(): boolean {
    return (this.cache ?? []).some((n) => !n.read);
  }
}
