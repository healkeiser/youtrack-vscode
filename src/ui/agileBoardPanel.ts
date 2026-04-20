import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { YouTrackClient } from '../client/youtrackClient';
import type { BoardView } from '../client/types';

export class AgileBoardPanel {
  private static instance: AgileBoardPanel | undefined;
  private panel: vscode.WebviewPanel;
  private state: BoardView = { columns: [], issuesByColumn: {} };

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private boardId: string,
    private sprintId: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'youtrackBoard', 'YouTrack Board', vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media', 'agileBoard')], retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack.png');
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => { AgileBoardPanel.instance = undefined; });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
  }

  static show(extensionUri: vscode.Uri, client: YouTrackClient, boardId: string, sprintId: string): void {
    if (AgileBoardPanel.instance) { AgileBoardPanel.instance.panel.reveal(); return; }
    AgileBoardPanel.instance = new AgileBoardPanel(extensionUri, client, boardId, sprintId);
    void AgileBoardPanel.instance.reload();
  }

  private shellHtml(): string {
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'agileBoard');
    const tpl = fs.readFileSync(path.join(mediaUri.fsPath, 'index.html'), 'utf-8');
    return tpl
      .replace('{{STYLE}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'style.css')).toString())
      .replace('{{MAIN}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.js')).toString());
  }

  private async reload(): Promise<void> {
    this.state = await this.client.fetchBoardView(this.boardId, this.sprintId);
    this.panel.webview.postMessage({ type: 'render', state: this.state });
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.type === 'ready') {
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
