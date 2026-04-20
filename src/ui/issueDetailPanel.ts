import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { Issue, Comment, Attachment, WorkItem } from '../client/types';
import { renderField } from './fieldRenderer';
import { parseDuration } from '../domain/timeTracker';

function escapeHtml(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export class IssueDetailPanel {
  private static panels = new Map<string, IssueDetailPanel>();
  private panel: vscode.WebviewPanel;
  private workTypes: Array<{ id: string; name: string }> = [];

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private cache: Cache,
    private issueId: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'youtrackIssue', issueId, vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media', 'issueDetail')], retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack_outline.svg');
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => IssueDetailPanel.panels.delete(issueId));
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
  }

  static show(extensionUri: vscode.Uri, client: YouTrackClient, cache: Cache, issueId: string): void {
    const existing = IssueDetailPanel.panels.get(issueId);
    if (existing) { existing.panel.reveal(); return; }
    const p = new IssueDetailPanel(extensionUri, client, cache, issueId);
    IssueDetailPanel.panels.set(issueId, p);
  }

  private shellHtml(): string {
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'issueDetail');
    const tpl = fs.readFileSync(path.join(mediaUri.fsPath, 'index.html'), 'utf-8');
    return tpl
      .replace('{{STYLE}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'style.css')).toString())
      .replace('{{MAIN}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.js')).toString());
  }

  private async reload(): Promise<void> {
    let issue: Issue;
    try {
      issue = await this.cache.getIssue(this.issueId, (id) => this.client.fetchIssue(id));
    } catch (e) {
      this.panel.webview.postMessage({
        type: 'render',
        html: `<div class="header"><div class="summary">Failed to load ${escapeHtml(this.issueId)}</div></div><pre>${escapeHtml((e as Error).message)}</pre>`,
      });
      return;
    }

    const [comments, attachments, workItems, types] = await Promise.all([
      this.client.fetchComments(this.issueId).catch(() => [] as Comment[]),
      this.client.fetchAttachments(this.issueId).catch(() => [] as Attachment[]),
      this.client.fetchWorkItems(this.issueId).catch(() => [] as WorkItem[]),
      this.workTypes.length
        ? Promise.resolve(this.workTypes)
        : this.client.listWorkItemTypes().catch(() => [] as Array<{ id: string; name: string }>),
    ]);
    this.workTypes = types;

    this.panel.webview.postMessage({ type: 'render', html: this.renderHtml(issue, comments, attachments, workItems) });
  }

  private renderHtml(issue: Issue, comments: Comment[], attachments: Attachment[], workItems: WorkItem[]): string {
    const fields = issue.customFields.map(renderField).join('');
    const commentHtml = comments.map((c) =>
      `<div class="comment"><b>${escapeHtml(c.author?.fullName)}</b> — ${new Date(c.created).toLocaleString()}<br>${escapeHtml(c.text)}</div>`
    ).join('');
    const attachHtml = attachments.map((a) =>
      `<div class="attachment"><a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a> <span>${a.size} B</span></div>`
    ).join('');
    const workHtml = workItems.map((w) => {
      const h = Math.floor(w.duration / 3600);
      const m = Math.floor((w.duration % 3600) / 60);
      const dur = h ? `${h}h ${m}m` : `${m}m`;
      return `<div class="work-item"><b>${escapeHtml(w.author?.fullName)}</b> — ${new Date(w.date).toLocaleDateString()} — ${dur} — ${escapeHtml(w.type?.name ?? '')}<br>${escapeHtml(w.text)}</div>`;
    }).join('');
    const typeOpts = this.workTypes.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    return `
      <div class="header">
        <div class="id">${escapeHtml(issue.idReadable)}</div>
        <div class="summary">${escapeHtml(issue.summary)}</div>
      </div>
      <div class="description">${escapeHtml(issue.description)}</div>
      <div class="section"><h3>Fields</h3>${fields}</div>
      <div class="section"><h3>Comments</h3>${commentHtml || '<i>None</i>'}</div>
      <div class="section"><h3>Attachments</h3>${attachHtml || '<i>None</i>'}</div>
      <div class="section">
        <h3>Time logged</h3>
        ${workHtml || '<i>None</i>'}
        <form class="log-time">
          <label>Duration</label><input name="duration" placeholder="1h30m" required>
          <label>Date</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required>
          <label>Type</label><select name="type">${typeOpts}</select>
          <label>Note</label><input name="text">
          <button type="submit">Log</button>
        </form>
      </div>
    `;
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.type === 'ready') {
      await this.reload();
      return;
    }
    if (msg.type === 'logTime') {
      const seconds = parseDuration(msg.duration ?? '');
      if (seconds === null || seconds <= 0) {
        vscode.window.showErrorMessage('YouTrack: could not parse duration');
        return;
      }
      try {
        await this.client.addWorkItem(this.issueId, {
          durationSeconds: seconds,
          date: new Date(msg.date).getTime(),
          typeId: msg.typeId || undefined,
          text: msg.text || undefined,
        });
        await this.reload();
      } catch (e) {
        vscode.window.showErrorMessage(`YouTrack: log time failed: ${(e as Error).message}`);
      }
    }
  }
}
