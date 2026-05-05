import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { BoardView } from '../client/types';
import { renderPanelHtml } from './webviewSecurity';
import { showYouTrackError } from '../client/errors';

interface BoardPrefs {
  sortMode?: string;
  colorBy?: string;
  filters?: { text?: string; assignee?: string; priority?: string; tag?: string };
}

function prefsKey(boardId: string): string {
  return `youtrack.boardPrefs.${boardId}`;
}

export class AgileBoardPanel {
  private static panels = new Map<string, AgileBoardPanel>();
  private panel: vscode.WebviewPanel;
  private state: BoardView = { columns: [], issuesByColumn: {} };
  private key: string;

  private cacheSub: { dispose(): void } | undefined;

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private cache: Cache,
    private boardId: string,
    private sprintId: string,
    private boardTitle: string,
    private context: vscode.ExtensionContext,
  ) {
    this.key = `${boardId}:${sprintId}`;
    this.panel = vscode.window.createWebviewPanel(
      'youtrackBoard', boardTitle, vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')], retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack.png');
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => {
      AgileBoardPanel.panels.delete(this.key);
      this.cacheSub?.dispose();
    });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    // Auto-reload when any issue changes: another tool (sidebar action,
    // detail panel, etc.) may have edited a card we're showing. We only
    // act when the panel is visible to avoid waking it up in the background.
    this.cacheSub = this.cache.onChange(() => {
      if (this.panel.visible) void this.reload();
    });
  }

  static show(
    extensionUri: vscode.Uri,
    client: YouTrackClient,
    cache: Cache,
    boardId: string,
    sprintId: string,
    boardTitle: string,
    context: vscode.ExtensionContext,
  ): void {
    const key = `${boardId}:${sprintId}`;
    const existing = AgileBoardPanel.panels.get(key);
    if (existing) { existing.panel.reveal(); return; }
    const p = new AgileBoardPanel(extensionUri, client, cache, boardId, sprintId, boardTitle, context);
    AgileBoardPanel.panels.set(key, p);
  }

  private shellHtml(): string {
    return renderPanelHtml(this.panel.webview, this.extensionUri, 'agileBoard');
  }

  private async reload(): Promise<void> {
    const [state, sprints, boards] = await Promise.all([
      this.client.fetchBoardView(this.boardId, this.sprintId),
      this.client.fetchSprints(this.boardId).catch(() => []),
      this.client.fetchAgileBoards().catch(() => []),
    ]);
    this.state = state;
    const board = boards.find((b) => b.id === this.boardId);
    const sprintsEnabled = board ? board.sprintsEnabled : true;
    const prefs = this.context.globalState.get<BoardPrefs>(prefsKey(this.boardId)) ?? {};
    this.panel.webview.postMessage({
      type: 'render',
      state,
      meta: {
        boardTitle: this.boardTitle,
        boardId: this.boardId,
        sprintId: this.sprintId,
        sprints,
        sprintsEnabled,
      },
      prefs,
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
    if (msg.type === 'createIssueInColumn') {
      // "+" on a column header — when the new issue lands we'll
      // transition it to the column's first state so it shows up
      // where the user asked.
      const stateName = typeof msg.state === 'string' ? msg.state : '';
      await vscode.commands.executeCommand('youtrack.createIssueWithState', stateName);
      void this.reload();
      return;
    }
    if (msg.type === 'openInBrowser') {
      // If the board has sprints disabled, open the root board URL
      // without a sprint segment — YouTrack resolves it to its own
      // no-sprint board view.
      const boards = await this.client.fetchAgileBoards().catch(() => []);
      const board = boards.find((b) => b.id === this.boardId);
      await vscode.commands.executeCommand('youtrack.openBoardInBrowser', {
        boardId: this.boardId,
        sprintId: board?.sprintsEnabled === false ? undefined : this.sprintId,
      });
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
    if (msg.type === 'saveBoardPrefs') {
      const prefs: BoardPrefs = {
        sortMode: typeof msg.sortMode === 'string' ? msg.sortMode : undefined,
        colorBy: typeof msg.colorBy === 'string' ? msg.colorBy : undefined,
        filters: msg.filters && typeof msg.filters === 'object' ? msg.filters : undefined,
      };
      await this.context.globalState.update(prefsKey(this.boardId), prefs);
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
        // Notifies the sidebar trees so they show the new state
        // immediately, and refreshes any cached copy of this issue.
        this.cache.invalidateIssue(String(msg.issueId));
      } catch (e) {
        showYouTrackError(e, 'move card');
        this.panel.webview.postMessage({ type: 'rollback', issueId: msg.issueId, fromColumnId: msg.fromColumnId });
      }
    }
  }
}
