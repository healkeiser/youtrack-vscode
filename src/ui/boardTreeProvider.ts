import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { AgileBoard } from '../client/types';

export class BoardTreeProvider implements vscode.TreeDataProvider<AgileBoard> {
  private _emitter = new vscode.EventEmitter<AgileBoard | undefined>();
  onDidChangeTreeData = this._emitter.event;
  private cachedBoards: AgileBoard[] | null = null;

  constructor(private client: YouTrackClient) {}

  refresh(): void {
    this.cachedBoards = null;
    this._emitter.fire(undefined);
  }

  async getChildren(element?: AgileBoard): Promise<AgileBoard[]> {
    if (element) return [];
    if (!this.cachedBoards) {
      this.cachedBoards = await this.client.fetchAgileBoards();
      this.cachedBoards.sort((a, b) => a.name.localeCompare(b.name));
    }
    return this.cachedBoards;
  }

  getTreeItem(board: AgileBoard): vscode.TreeItem {
    const t = new vscode.TreeItem(board.name, vscode.TreeItemCollapsibleState.None);
    t.iconPath = new vscode.ThemeIcon('project');
    t.contextValue = 'board';
    if (board.projects?.length) {
      t.description = board.projects.map((p) => p.shortName).join(', ');
    }
    t.command = { command: 'youtrack.openBoard', title: 'Open Board', arguments: [board.id] };
    t.tooltip = board.projects?.length
      ? `${board.name} — ${board.projects.map((p) => p.shortName).join(', ')}`
      : board.name;
    return t;
  }
}
