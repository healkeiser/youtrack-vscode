import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { YouTrackClient } from '../client/youtrackClient';
import type { BoardView } from '../client/types';

export class AgileBoardPanel {
  private static panels = new Map<string, AgileBoardPanel>();
  private panel: vscode.WebviewPanel;
  private state: BoardView = { columns: [], issuesByColumn: {} };
  private key: string;

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private boardId: string,
    private sprintId: string,
    private boardTitle: string,
  ) {
    this.key = `${boardId}:${sprintId}`;
    this.panel = vscode.window.createWebviewPanel(
      'youtrackBoard', boardTitle, vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')], retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack.png');
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => { AgileBoardPanel.panels.delete(this.key); });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
  }

  static show(extensionUri: vscode.Uri, client: YouTrackClient, boardId: string, sprintId: string, boardTitle = 'YouTrack Board'): void {
    const key = `${boardId}:${sprintId}`;
    const existing = AgileBoardPanel.panels.get(key);
    if (existing) { existing.panel.reveal(); return; }
    const p = new AgileBoardPanel(extensionUri, client, boardId, sprintId, boardTitle);
    AgileBoardPanel.panels.set(key, p);
  }

  private shellHtml(): string {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panelUri = vscode.Uri.joinPath(mediaRoot, 'agileBoard');
    const tpl = fs.readFileSync(path.join(panelUri.fsPath, 'index.html'), 'utf-8');
    return tpl
      .replace('{{CODICONS}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'codicons', 'codicon.css')).toString())
      .replace('{{SHARED}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'shared.css')).toString())
      .replace('{{STYLE}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(panelUri, 'style.css')).toString())
      .replace('{{MAIN}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(panelUri, 'main.js')).toString());
  }

  private async reload(): Promise<void> {
    const [state, sprints] = await Promise.all([
      this.client.fetchBoardView(this.boardId, this.sprintId),
      this.client.fetchSprints(this.boardId).catch(() => []),
    ]);
    this.state = state;
    this.panel.webview.postMessage({
      type: 'render',
      state,
      meta: {
        boardTitle: this.boardTitle,
        boardId: this.boardId,
        sprintId: this.sprintId,
        sprints,
      },
    });
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.type === 'ready') {
      void this.reload();
      return;
    }
    if (msg.type === 'refresh') {
      void this.reload();
      return;
    }
    if (msg.type === 'createIssue') {
      await vscode.commands.executeCommand('youtrack.createIssue');
      void this.reload();
      return;
    }
    if (msg.type === 'switchSprint' && typeof msg.sprintId === 'string') {
      this.sprintId = msg.sprintId;
      const newKey = `${this.boardId}:${this.sprintId}`;
      AgileBoardPanel.panels.delete(this.key);
      AgileBoardPanel.panels.set(newKey, this);
      this.key = newKey;
      void this.reload();
      return;
    }
    if (msg.type === 'openIssue') {
      vscode.commands.executeCommand('youtrack.openIssue', msg.issueId);
      return;
    }
    if (msg.type === 'moveCard') {
      const col = this.state.columns.find((c) => c.id === msg.toColumnId);
      const state = col?.states[0];
      if (!state) {
        this.panel.webview.postMessage({ type: 'rollback', issueId: msg.issueId, fromColumnId: msg.fromColumnId });
        return;
      }
      try {
        await this.client.transitionState(msg.issueId, state);
      } catch (e) {
        vscode.window.showErrorMessage(`YouTrack: move failed: ${(e as Error).message}`);
        this.panel.webview.postMessage({ type: 'rollback', issueId: msg.issueId, fromColumnId: msg.fromColumnId });
      }
    }
  }
}
