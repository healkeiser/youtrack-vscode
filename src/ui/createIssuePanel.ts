import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { marked } from 'marked';
import type { YouTrackClient } from '../client/youtrackClient';

export class CreateIssuePanel {
  private static current: CreateIssuePanel | undefined;
  private panel: vscode.WebviewPanel;
  private projectsPromise: Promise<Array<{ id: string; shortName: string; name: string }>> | null = null;

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private onCreated?: (idReadable: string) => void,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'youtrackCreate',
      'Create Issue',
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')], retainContextWhenHidden: false },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack.png');
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => { CreateIssuePanel.current = undefined; });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
  }

  static show(
    extensionUri: vscode.Uri,
    client: YouTrackClient,
    onCreated?: (id: string) => void,
  ): void {
    if (CreateIssuePanel.current) {
      CreateIssuePanel.current.panel.reveal();
      return;
    }
    CreateIssuePanel.current = new CreateIssuePanel(extensionUri, client, onCreated);
  }

  private shellHtml(): string {
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panelUri = vscode.Uri.joinPath(mediaRoot, 'createIssue');
    const tpl = fs.readFileSync(path.join(panelUri.fsPath, 'index.html'), 'utf-8');
    return tpl
      .replace('{{SHARED}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'shared.css')).toString())
      .replace('{{STYLE}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(panelUri, 'style.css')).toString())
      .replace('{{MAIN}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(panelUri, 'main.js')).toString());
  }

  private getProjects() {
    if (!this.projectsPromise) {
      this.projectsPromise = this.client.listProjects().then((list) =>
        list.sort((a, b) => a.shortName.localeCompare(b.shortName)),
      );
    }
    return this.projectsPromise;
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.type === 'ready') {
      try {
        const projects = await this.getProjects();
        const defaultShortName = vscode.workspace.getConfiguration('youtrack').get<string>('defaultProject', '');
        this.panel.webview.postMessage({ type: 'init', projects, defaultShortName });
      } catch (e) {
        this.panel.webview.postMessage({ type: 'error', message: `Failed to load projects: ${(e as Error).message}` });
      }
      return;
    }
    if (msg.type === 'renderPreview') {
      const text = String(msg.text ?? '');
      const html = text.trim()
        ? (marked.parse(text, { async: false }) as string)
        : '<p style="color:var(--vscode-descriptionForeground);font-style:italic">Nothing to preview.</p>';
      this.panel.webview.postMessage({ type: 'previewHtml', html });
      return;
    }
    if (msg.type === 'cancel') {
      this.panel.dispose();
      return;
    }
    if (msg.type === 'submit') {
      const projectId = String(msg.projectId || '');
      const summary = String(msg.summary || '').trim();
      const description = String(msg.description || '');
      if (!projectId || !summary) {
        this.panel.webview.postMessage({ type: 'error', message: 'Project and summary are required.' });
        return;
      }
      this.panel.webview.postMessage({ type: 'creating' });
      try {
        const { idReadable } = await this.client.createIssue(projectId, summary, description);
        this.panel.dispose();
        vscode.window.showInformationMessage(`YouTrack: created ${idReadable}`);
        if (this.onCreated) this.onCreated(idReadable);
        vscode.commands.executeCommand('youtrack.openIssue', idReadable);
      } catch (e) {
        this.panel.webview.postMessage({ type: 'error', message: `Create failed: ${(e as Error).message}` });
      }
    }
  }
}
