import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { marked } from 'marked';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { Issue, Comment, Attachment, WorkItem, User, CustomField, CustomFieldValue, Tag } from '../client/types';
import { parseDuration } from '../domain/timeTracker';

marked.setOptions({ gfm: true, breaks: false });

function escapeHtml(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function resolveMentions(raw: string, userLookup: Map<string, User>): string {
  const MENTION_RE = /@([A-Za-z0-9._\-]+)/g;
  return raw.replace(MENTION_RE, (full, login: string) => {
    const user = userLookup.get(login);
    if (!user) return full;
    return `<span class="mention" title="@${escapeHtml(login)}">@${escapeHtml(user.fullName || user.login)}</span>`;
  });
}

function renderBody(raw: string | null | undefined, userLookup: Map<string, User>): string {
  if (!raw) return '';
  const withMentions = resolveMentions(raw, userLookup);
  const html = marked.parse(withMentions, { async: false }) as string;
  return html;
}

function stateSlug(name: string): string {
  const s = name.toLowerCase();
  if (/(done|fixed|closed|resolved|verified|complete)/.test(s)) return 'state-done';
  if (/(progress|develop|working|wip|active)/.test(s)) return 'state-progress';
  if (/(review|pending|waiting|qa|test)/.test(s)) return 'state-review';
  if (/(cancel|reject|won|invalid|duplicate|obsolete)/.test(s)) return 'state-cancelled';
  if (/(block|hold|paused)/.test(s)) return 'state-blocked';
  return '';
}

function prioritySlug(name: string): string {
  const s = name.toLowerCase().replace(/\s+/g, '-');
  return `prio-${s}`;
}

function initials(user: User): string {
  if (user.fullName) {
    const parts = user.fullName.split(/\s+/).filter(Boolean).slice(0, 2);
    const inits = parts.map((p) => p[0]?.toUpperCase()).join('');
    if (inits) return inits;
  }
  return (user.login || '?').slice(0, 2).toUpperCase();
}

function renderAvatar(user: User | null | undefined): string {
  if (!user) return `<span class="avatar">?</span>`;
  const init = escapeHtml(initials(user));
  if (user.avatarUrl && /^https?:/.test(user.avatarUrl)) {
    return `<span class="avatar">${init}<img src="${escapeHtml(user.avatarUrl)}" referrerpolicy="no-referrer" onerror="this.style.display='none'" alt=""></span>`;
  }
  return `<span class="avatar">${init}</span>`;
}

function renderUserChip(user: User | null | undefined): string {
  if (!user) return '<span class="value">—</span>';
  return `<span class="user-chip">${renderAvatar(user)}<span>${escapeHtml(user.fullName || user.login)}</span></span>`;
}

function formatPeriod(seconds: number): string {
  const total = Number(seconds) || 0;
  if (!total) return '—';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function valueAsText(v: CustomFieldValue): string {
  switch (v.kind) {
    case 'empty':   return '—';
    case 'enum':    return v.name ?? '—';
    case 'state':   return v.name ?? '—';
    case 'user':    return v.fullName ?? v.login ?? '—';
    case 'string':  return v.text ?? '—';
    case 'date':    return v.iso ? new Date(v.iso).toLocaleDateString() : '—';
    case 'period':  return formatPeriod(v.seconds);
    case 'number':  return String(v.value ?? 0);
    case 'bool':    return v.value ? 'Yes' : 'No';
    case 'version': return v.name ?? '—';
    case 'unknown': return v.raw ?? '—';
  }
}

function formattingToolbarHtml(): string {
  return `
    <div class="md-tabs">
      <button type="button" class="md-tab active" data-md-tab="write">Write</button>
      <button type="button" class="md-tab" data-md-tab="preview">Preview</button>
    </div>
    <div class="comment-toolbar">
      <button type="button" data-md="bold" title="Bold (Ctrl+B)"><strong>B</strong></button>
      <button type="button" data-md="italic" title="Italic (Ctrl+I)"><em>I</em></button>
      <button type="button" data-md="strike" title="Strikethrough"><s>S</s></button>
      <button type="button" data-md="code" title="Inline code (Ctrl+E)">&lt;/&gt;</button>
      <button type="button" data-md="codeblock" title="Code block">{ }</button>
      <button type="button" data-md="link" title="Link (Ctrl+K)">🔗</button>
      <span class="sep"></span>
      <button type="button" data-md="ul" title="Bulleted list">•</button>
      <button type="button" data-md="ol" title="Numbered list">1.</button>
      <button type="button" data-md="quote" title="Quote">&gt;</button>
      <span class="sep"></span>
      <button type="button" data-md="mention" title="Mention user">@</button>
    </div>
  `;
}

function renderTag(tag: Tag): string {
  const bg = tag.color?.background || '';
  const fg = tag.color?.foreground || '';
  const style = [
    bg ? `background:${bg}` : 'background:var(--vscode-editor-inactiveSelectionBackground)',
    fg ? `color:${fg}` : 'color:var(--vscode-foreground)',
  ].join(';');
  return `<span class="tag-pill" style="${escapeHtml(style)}">${escapeHtml(tag.name)}</span>`;
}

function renderSideField(f: CustomField): string {
  const v = f.value;
  const name = escapeHtml(f.name);
  if (f.name === 'State' && (v.kind === 'state' || v.kind === 'enum')) {
    const letter = v.name[0]?.toUpperCase() ?? '?';
    const style = v.color?.background
      ? `background:${v.color.background};color:${v.color.foreground || 'white'}`
      : '';
    const extraClass = style ? '' : ` ${stateSlug(v.name)}`;
    return `<div class="side-field"><span class="label">${name}</span><span class="value"><span class="badge-letter${extraClass}" style="${escapeHtml(style)}">${escapeHtml(letter)}</span> ${escapeHtml(v.name)}</span></div>`;
  }
  if (f.name === 'Priority' && v.kind === 'enum') {
    const letter = v.name[0]?.toUpperCase() ?? '?';
    const style = v.color?.background
      ? `background:${v.color.background};color:${v.color.foreground || 'white'}`
      : '';
    const extraClass = style ? '' : ` ${prioritySlug(v.name)}`;
    return `<div class="side-field"><span class="label">${name}</span><span class="value"><span class="badge-letter priority-badge${extraClass}" style="${escapeHtml(style)}">${escapeHtml(letter)}</span> ${escapeHtml(v.name)}</span></div>`;
  }
  if (v.kind === 'user') {
    return `<div class="side-field"><span class="label">${name}</span><span class="value">${renderUserChip({ id: '', login: v.login, fullName: v.fullName, avatarUrl: v.avatarUrl })}</span></div>`;
  }
  return `<div class="side-field"><span class="label">${name}</span><span class="value">${escapeHtml(valueAsText(v))}</span></div>`;
}

export class IssueDetailPanel {
  private static panels = new Map<string, IssueDetailPanel>();
  private panel: vscode.WebviewPanel;
  private workTypes: Array<{ id: string; name: string }> = [];
  private userLookup = new Map<string, User>();
  private currentUserLogin = '';

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private cache: Cache,
    private issueId: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'youtrackIssue', issueId, vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')], retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack.png');
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
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panelUri = vscode.Uri.joinPath(mediaRoot, 'issueDetail');
    const tpl = fs.readFileSync(path.join(panelUri.fsPath, 'index.html'), 'utf-8');
    return tpl
      .replace('{{SHARED}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'shared.css')).toString())
      .replace('{{STYLE}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(panelUri, 'style.css')).toString())
      .replace('{{MAIN}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(panelUri, 'main.js')).toString());
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

    const truncated = issue.summary.length > 60 ? issue.summary.slice(0, 60).trimEnd() + '…' : issue.summary;
    this.panel.title = `${issue.idReadable}: ${truncated}`;

    const [comments, attachments, workItems, types, users, me] = await Promise.all([
      this.client.fetchComments(this.issueId).catch(() => [] as Comment[]),
      this.client.fetchAttachments(this.issueId).catch(() => [] as Attachment[]),
      this.client.fetchWorkItems(this.issueId).catch(() => [] as WorkItem[]),
      this.workTypes.length
        ? Promise.resolve(this.workTypes)
        : this.client.listWorkItemTypes().catch(() => [] as Array<{ id: string; name: string }>),
      this.userLookup.size
        ? Promise.resolve([] as User[])
        : this.client.listUsers('', 200).catch(() => [] as User[]),
      this.currentUserLogin
        ? Promise.resolve(null)
        : this.client.getMe().catch(() => null),
    ]);
    this.workTypes = types;
    for (const u of users) this.userLookup.set(u.login, u);
    if (me && me.login) this.currentUserLogin = me.login;

    this.panel.webview.postMessage({ type: 'render', html: this.renderHtml(issue, comments, attachments, workItems) });
  }

  private renderHtml(issue: Issue, comments: Comment[], attachments: Attachment[], workItems: WorkItem[]): string {
    const sideFields = issue.customFields.map(renderSideField).join('');
    const projectRow = `<div class="side-field"><span class="label">Project</span><span class="value">${escapeHtml(issue.project.shortName)}</span></div>`;
    const reporterRow = issue.reporter
      ? `<div class="side-field"><span class="label">Reporter</span><span class="value">${renderUserChip(issue.reporter)}</span></div>`
      : '';
    const tagsRow = `<div class="side-field"><span class="label">Tags</span><span class="value tags-value">${
      issue.tags.length ? issue.tags.map(renderTag).join('') : '—'
    }</span></div>`;

    const attachHtml = attachments.map((a) =>
      `<div class="attachment"><span>📎</span><a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a><span style="color:var(--vscode-descriptionForeground);font-size:0.85em">${a.size} B</span></div>`
    ).join('');

    type Entry = { ts: number; html: string };
    const entries: Entry[] = [];
    for (const c of comments) {
      const isMine = !!c.author?.login && c.author.login === this.currentUserLogin;
      const editForm = isMine ? `
            <form class="comment-edit md-form" data-comment-id="${escapeHtml(c.id)}" hidden>
              ${formattingToolbarHtml()}
              <textarea name="text" required>${escapeHtml(c.text)}</textarea>
              <div class="md-preview md-body" hidden></div>
              <div class="edit-actions">
                <button type="submit" class="primary">Save</button>
                <button type="button" data-comment-edit-cancel>Cancel</button>
              </div>
            </form>` : '';
      const editBtn = isMine ? `<button type="button" class="comment-edit-btn" data-edit-comment="${escapeHtml(c.id)}" title="Edit">✎</button>` : '';
      entries.push({
        ts: c.created,
        html: `
          <div class="activity-entry" data-activity-comment="${escapeHtml(c.id)}">
            <div class="meta">${renderAvatar(c.author)}<b>${escapeHtml(c.author?.fullName ?? c.author?.login ?? '')}</b>commented · ${escapeHtml(new Date(c.created).toLocaleString())}<span class="spacer"></span>${editBtn}</div>
            <div class="body md-body comment-view">${renderBody(c.text, this.userLookup)}</div>
            ${editForm}
          </div>`,
      });
    }
    for (const w of workItems) {
      const dur = formatPeriod(w.duration);
      const typeLabel = w.type?.name ? ` · ${escapeHtml(w.type.name)}` : '';
      entries.push({
        ts: w.date,
        html: `
          <div class="activity-entry work">
            <div class="meta">${renderAvatar(w.author)}<b>${escapeHtml(w.author?.fullName ?? w.author?.login ?? '')}</b>logged <strong>${dur}</strong>${typeLabel} · ${escapeHtml(new Date(w.date).toLocaleDateString())}</div>
            ${w.text ? `<div class="body">${renderBody(w.text, this.userLookup)}</div>` : ''}
          </div>`,
      });
    }
    entries.sort((a, b) => b.ts - a.ts);
    const activityHtml = entries.length ? entries.map((e) => e.html).join('') : '<div style="color:var(--vscode-descriptionForeground);font-style:italic;padding:0.5rem 0">No activity yet.</div>';

    const typeOpts = this.workTypes.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');

    const descriptionBody = issue.description
      ? `<div class="description md-body">${renderBody(issue.description, this.userLookup)}</div>`
      : `<div class="description empty">No description.</div>`;

    return `
      <div class="layout">
        <div class="main">
          <div class="header">
            <div class="id-row"><span class="id">${escapeHtml(issue.idReadable)}</span><span class="sep">·</span><span>${escapeHtml(issue.project.shortName)}</span></div>
            <div class="editable" data-field="summary">
              <div class="editable-view">
                <div class="summary">${escapeHtml(issue.summary)}</div>
                <button class="edit-btn" data-edit="summary" title="Edit summary">✎</button>
              </div>
              <form class="editable-edit summary-edit" data-edit-form="summary" hidden>
                <input type="text" name="text" value="${escapeHtml(issue.summary)}" required>
                <div class="edit-actions">
                  <button type="submit" class="primary">Save</button>
                  <button type="button" data-edit-cancel="summary">Cancel</button>
                </div>
              </form>
            </div>
            <div class="toolbar">
              <button class="primary" data-cmd="startWork" title="Start Work (transition + branch)">▶ Start Work</button>
              <button data-cmd="assignToMe" title="Assign to me">Assign</button>
              <button data-cmd="changeState" title="Change state">State…</button>
              <button data-cmd="logTime" title="Log time">Log Time</button>
              <button data-cmd="createBranch" title="Create git branch from issue">Branch</button>
              <button data-cmd="copyLink" title="Copy issue link">Copy</button>
              <button data-cmd="openInBrowser" title="Open in browser">Open</button>
            </div>
            <div class="editable" data-field="description">
              <div class="editable-view">
                ${descriptionBody}
                <button class="edit-btn edit-btn-floating" data-edit="description" title="Edit description">✎</button>
              </div>
              <form class="editable-edit description-edit md-form" data-edit-form="description" hidden>
                ${formattingToolbarHtml()}
                <textarea name="text" placeholder="Markdown supported">${escapeHtml(issue.description)}</textarea>
                <div class="md-preview md-body" hidden></div>
                <div class="edit-actions">
                  <button type="submit" class="primary">Save</button>
                  <button type="button" data-edit-cancel="description">Cancel</button>
                </div>
              </form>
            </div>
          </div>
          ${attachments.length ? `<div class="section"><h3>Attachments</h3>${attachHtml}</div>` : ''}
          <div class="section">
            <h3>Activity</h3>
            ${activityHtml}
            <button type="button" class="inline-toggle" data-inline-toggle="comment">+ Add a comment</button>
            <form class="add-comment md-form collapsed" data-collapsible="comment">
              ${formattingToolbarHtml()}
              <textarea name="text" placeholder="Write a comment... (markdown supported)" required></textarea>
              <div class="md-preview md-body" hidden></div>
              <button type="submit">Post Comment</button>
            </form>
          </div>
          <div class="section">
            <h3>Log time</h3>
            <button type="button" class="inline-toggle" data-inline-toggle="logtime">+ Add spent time</button>
            <form class="log-time collapsed" data-collapsible="logtime">
              <label>Duration</label><input name="duration" placeholder="1h30m" required>
              <label>Date</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required>
              <label>Type</label><select name="type">${typeOpts}</select>
              <label>Note</label><input name="text" placeholder="optional">
              <button type="submit">Log</button>
            </form>
          </div>
        </div>
        <aside class="side">
          <h4>Details</h4>
          ${projectRow}
          ${reporterRow}
          ${sideFields}
          ${tagsRow}
        </aside>
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
      return;
    }
    if (msg.type === 'addComment') {
      const text = String(msg.text ?? '').trim();
      if (!text) return;
      try {
        await this.client.addComment(this.issueId, text);
        await this.reload();
      } catch (e) {
        vscode.window.showErrorMessage(`YouTrack: add comment failed: ${(e as Error).message}`);
      }
      return;
    }
    if (msg.type === 'updateComment') {
      const commentId = String(msg.commentId ?? '');
      const text = String(msg.text ?? '').trim();
      if (!commentId || !text) return;
      try {
        await this.client.updateComment(this.issueId, commentId, text);
        await this.reload();
      } catch (e) {
        vscode.window.showErrorMessage(`YouTrack: update comment failed: ${(e as Error).message}`);
      }
      return;
    }
    if (msg.type === 'renderPreview') {
      const text = String(msg.text ?? '');
      const html = text.trim() ? renderBody(text, this.userLookup) : '<p style="color:var(--vscode-descriptionForeground);font-style:italic">Nothing to preview.</p>';
      this.panel.webview.postMessage({ type: 'previewHtml', formId: msg.formId, html });
      return;
    }
    if (msg.type === 'updateField') {
      const field = msg.field === 'summary' || msg.field === 'description' ? msg.field : null;
      if (!field) return;
      const value = String(msg.value ?? '');
      if (field === 'summary' && !value.trim()) {
        vscode.window.showErrorMessage('YouTrack: summary cannot be empty');
        return;
      }
      try {
        await this.client.updateIssue(this.issueId, { [field]: value });
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        vscode.window.showErrorMessage(`YouTrack: update failed: ${(e as Error).message}`);
      }
      return;
    }
    if (msg.type === 'pickMention') {
      try {
        const users = await this.client.listUsers('', 50);
        const picked = await vscode.window.showQuickPick(
          users.map((u) => ({ label: u.login, description: u.fullName })),
          { placeHolder: 'Mention a user', matchOnDescription: true, ignoreFocusOut: true },
        );
        if (picked) this.panel.webview.postMessage({ type: 'insertMention', login: picked.label });
      } catch (e) {
        vscode.window.showErrorMessage(`YouTrack: couldn't load users: ${(e as Error).message}`);
      }
      return;
    }
    if (msg.type === 'cmd') {
      const map: Record<string, string> = {
        startWork: 'youtrack.startWork',
        assignToMe: 'youtrack.assignToMe',
        changeState: 'youtrack.changeState',
        logTime: 'youtrack.logTime',
        createBranch: 'youtrack.createBranch',
        copyLink: 'youtrack.copyLink',
        openInBrowser: 'youtrack.openInBrowser',
      };
      const cmd = map[msg.id];
      if (!cmd) return;
      await vscode.commands.executeCommand(cmd, this.issueId);
      await this.reload();
      return;
    }
  }
}
