import * as vscode from 'vscode';
import { marked } from 'marked';
import type { YouTrackClient } from '../client/youtrackClient';
import { renderPanelHtml } from './webviewSecurity';

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
    return renderPanelHtml(this.panel.webview, this.extensionUri, 'createIssue');
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
        const [projects, users] = await Promise.all([
          this.getProjects(),
          this.client.listUsers('', 200).catch(() => []),
        ]);
        const defaultShortName = vscode.workspace.getConfiguration('youtrack').get<string>('defaultProject', '');
        this.panel.webview.postMessage({ type: 'init', projects, defaultShortName, users });
      } catch (e) {
        this.panel.webview.postMessage({ type: 'error', message: `Failed to load projects: ${(e as Error).message}` });
      }
      return;
    }
    if (msg.type === 'fetchProjectFields') {
      const projectId = String(msg.projectId || '');
      if (!projectId) return;
      const [typeValues, priorityValues] = await Promise.all([
        this.client.fetchProjectFieldValues(projectId, 'Type').catch(() => []),
        this.client.fetchProjectFieldValues(projectId, 'Priority').catch(() => []),
      ]);
      this.panel.webview.postMessage({ type: 'projectFields', typeValues, priorityValues });
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
        const type = String(msg.issueType ?? '').trim();
        const priority = String(msg.priority ?? '').trim();
        const assignee = String(msg.assignee ?? '').trim();

        const followUps: Array<Promise<unknown>> = [];
        if (type)     followUps.push(this.client.setEnumField(idReadable, 'Type', type).catch((e) => vscode.window.showWarningMessage(`YouTrack: set Type failed: ${(e as Error).message}`)));
        if (priority) followUps.push(this.client.setEnumField(idReadable, 'Priority', priority).catch((e) => vscode.window.showWarningMessage(`YouTrack: set Priority failed: ${(e as Error).message}`)));
        if (assignee) followUps.push(this.client.assignIssue(idReadable, assignee).catch((e) => vscode.window.showWarningMessage(`YouTrack: assign failed: ${(e as Error).message}`)));
        await Promise.all(followUps);

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
