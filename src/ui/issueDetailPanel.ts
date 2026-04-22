import * as vscode from 'vscode';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { Issue, Comment, Attachment, WorkItem, User, CustomField, CustomFieldValue, Tag, IssueLink } from '../client/types';
import { parseDuration } from '../domain/timeTracker';
import { renderPanelHtml } from './webviewSecurity';
import { showYouTrackError } from '../client/errors';
import { primeUserAvatars, userAvatarUri } from './userAvatar';
import { escapeHtml, formatPeriod, formatBytes } from '../util/format';
import { buildPickerItems } from './inlinePickerBroker';
import { stateVisuals } from '../util/stateVisuals';

marked.setOptions({ gfm: true, breaks: false });

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'figcaption', 'figure',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li', 'mark',
    'ol', 'p', 'pre', 's', 'samp', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    '*': ['class', 'title'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    input: ['type', 'checked', 'disabled'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel', 'vscode'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};


function resolveMentions(raw: string, userLookup: Map<string, User>): string {
  const MENTION_RE = /@([A-Za-z0-9._\-]+)/g;
  return raw.replace(MENTION_RE, (full, login: string) => {
    const user = userLookup.get(login);
    if (!user) return full;
    return `<span class="mention" title="@${escapeHtml(login)}">@${escapeHtml(user.fullName || user.login)}</span>`;
  });
}

// YouTrack stores image/file references inside comment markdown as
// `![](filename.png)` or `[label](filename.pdf)` — just the bare
// attachment name, not a URL. The browser would treat that as a relative
// reference and fail to load anything. Resolve each to the real signed
// URL by looking it up in the issue's attachments list. Tolerates URL-
// encoded spaces and percent-encoded names.
function buildAttachmentByName(attachments: Attachment[]): Map<string, string> {
  const byName = new Map<string, string>();
  for (const a of attachments) byName.set(a.name.toLowerCase(), a.url);
  return byName;
}

function resolveAttachmentRefs(raw: string, byName: Map<string, string>): string {
  if (!raw || !byName.size) return raw;
  return raw.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (match, bang, text, url) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return match;      // already absolute
    if (url.startsWith('//') || url.startsWith('/')) return match;
    if (url.includes('/')) return match;                     // looks pathy
    const candidate = (() => {
      try { return decodeURIComponent(url); } catch { return url; }
    })();
    const hit = byName.get(candidate.toLowerCase()) ?? byName.get(url.toLowerCase());
    if (!hit) return match;
    return `${bang}[${text || candidate}](${hit})`;
  });
}

// Second pass: rewrite any <img src="filename"> / <a href="filename">
// in the already-rendered HTML. Catches cases where YouTrack stores
// weird markup or a reference-style link we can't reach pre-markdown.
function resolveAttachmentHtmlRefs(html: string, byName: Map<string, string>): string {
  if (!html || !byName.size) return html;
  return html.replace(/(\s(?:src|href)=")([^"]+)"/gi, (match, prefix, url) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return match;
    if (url.startsWith('//') || url.startsWith('/')) return match;
    if (url.includes('/')) return match;
    const candidate = (() => { try { return decodeURIComponent(url); } catch { return url; } })();
    const hit = byName.get(candidate.toLowerCase());
    return hit ? `${prefix}${hit}"` : match;
  });
}

function renderBody(
  raw: string | null | undefined,
  userLookup: Map<string, User>,
  attachments: Attachment[] | Map<string, string> = [],
): string {
  if (!raw) return '';
  const byName = attachments instanceof Map ? attachments : buildAttachmentByName(attachments);
  const withMentions = resolveMentions(raw, userLookup);
  const withRefs = resolveAttachmentRefs(withMentions, byName);
  const html = marked.parse(withRefs, { async: false }) as string;
  const sanitized = sanitizeHtml(html, SANITIZE_OPTIONS);
  return resolveAttachmentHtmlRefs(sanitized, byName);
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

// DateIssueCustomField and DateTimeIssueCustomField collapse into the
// same `date` kind — show the time component only when it carries info
// (i.e. the value isn't midnight local-time), otherwise render a bare
// date. Avoids noisy "12:00:00 AM" tails on pure-date fields.
// YouTrack's reaction name → emoji. Matches the set offered in the web
// UI's reaction picker. Unknown names fall through as the name itself.
const REACTION_EMOJI: Record<string, string> = {
  'thumbs-up': '👍',
  'thumbs-down': '👎',
  'smile': '😄',
  'tada': '🎉',
  'thinking': '🤔',
  'heart': '❤️',
  'rocket': '🚀',
  'eyes': '👀',
};

function reactionGlyph(name: string): string {
  return REACTION_EMOJI[name] ?? name;
}

function renderReactionChips(
  commentId: string,
  reactions: Array<{ id: string; reaction: string; author: { login: string; fullName: string } }>,
  currentUserLogin: string,
): string {
  if (!reactions.length) return '';
  // Group identical reactions so we get "👍 2" chips instead of a
  // separate pill per user. Track whether the current user reacted so
  // the chip gets an "active" styling + their reaction id (for removal).
  const groups = new Map<string, { glyph: string; count: number; myId?: string; who: string[] }>();
  for (const r of reactions) {
    const g = groups.get(r.reaction) ?? { glyph: reactionGlyph(r.reaction), count: 0, who: [] };
    g.count += 1;
    if (r.author.login === currentUserLogin) g.myId = r.id;
    g.who.push(r.author.fullName || r.author.login);
    groups.set(r.reaction, g);
  }
  const chips = [...groups.entries()].map(([name, g]) => {
    const title = g.who.join(', ');
    const action = g.myId
      ? `data-remove-reaction-id="${escapeHtml(g.myId)}"`
      : `data-add-reaction="${escapeHtml(name)}"`;
    return `<button type="button" class="reaction-chip${g.myId ? ' active' : ''}" data-react-comment-target="${escapeHtml(commentId)}" ${action} title="${escapeHtml(title)}">
      <span class="reaction-glyph">${g.glyph}</span>
      <span class="reaction-count">${g.count}</span>
    </button>`;
  }).join('');
  return `<div class="reactions-row">${chips}</div>`;
}

function renderAttachmentTile(a: Attachment): string {
  const isImage = (a.mimeType ?? '').toLowerCase().startsWith('image/')
    || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.name);
  const size = formatBytes(a.size);
  if (isImage) {
    // No href: images open in the in-panel lightbox on pointerdown. The
    // URL is carried in data-href so it's still copyable via JS if we
    // want to add "copy link" later.
    return `<div class="attachment-tile image" data-href="${escapeHtml(a.url)}" data-lightbox="1" title="${escapeHtml(a.name)} — ${size}">
        <img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}">
        <span class="attachment-meta"><span class="name">${escapeHtml(a.name)}</span><span class="size">${size}</span></span>
      </div>`;
  }
  return `<a class="attachment-tile file" href="${escapeHtml(a.url)}" title="${escapeHtml(a.name)} — ${size}">
      <i class="codicon codicon-file"></i>
      <span class="attachment-meta"><span class="name">${escapeHtml(a.name)}</span><span class="size">${size}</span></span>
    </a>`;
}

// "2 hours ago", "just now", etc. — used in comment/activity headers
// alongside a full-datetime tooltip. Compact because the header row is
// already busy with author + verb.
function formatRelative(epochMs: number): string {
  const ms = Date.now() - epochMs;
  if (!Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.round(d / 365);
  return `${y}y ago`;
}

function formatDateOrDateTime(iso: string, hasTime = true): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (!hasTime) return d.toLocaleDateString();
  const isMidnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  return isMidnight ? d.toLocaleDateString() : d.toLocaleString();
}

function valueAsText(v: CustomFieldValue, fieldType?: string): string {
  switch (v.kind) {
    case 'empty':   return '—';
    case 'enum':    return v.name ?? '—';
    case 'state':   return v.name ?? '—';
    case 'user':    return v.fullName ?? v.login ?? '—';
    case 'string':  return v.text ?? '—';
    case 'date':    return v.iso ? formatDateOrDateTime(v.iso, fieldType === 'datetime') : '—';
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
      <button type="button" data-md="bold" title="Bold (Ctrl+B)"><i class="codicon codicon-bold"></i></button>
      <button type="button" data-md="italic" title="Italic (Ctrl+I)"><i class="codicon codicon-italic"></i></button>
      <button type="button" data-md="strike" title="Strikethrough"><i class="codicon codicon-symbol-string"></i></button>
      <button type="button" data-md="code" title="Inline code (Ctrl+E)"><i class="codicon codicon-code"></i></button>
      <button type="button" data-md="codeblock" title="Code block"><i class="codicon codicon-json"></i></button>
      <button type="button" data-md="link" title="Link (Ctrl+K)"><i class="codicon codicon-link"></i></button>
      <span class="sep"></span>
      <button type="button" data-md="ul" title="Bulleted list"><i class="codicon codicon-list-unordered"></i></button>
      <button type="button" data-md="ol" title="Numbered list"><i class="codicon codicon-list-ordered"></i></button>
      <button type="button" data-md="quote" title="Quote"><i class="codicon codicon-quote"></i></button>
      <span class="sep"></span>
      <button type="button" data-md="mention" title="Mention user"><i class="codicon codicon-mention"></i></button>
      <button type="button" data-md="attach" title="Attach file"><i class="codicon codicon-cloud-upload"></i></button>
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

function renderChangeVerb(a: {
  category: string;
  field?: string;
  added: string[];
  removed: string[];
}): string {
  const field = a.field ? `<em>${escapeHtml(a.field)}</em>` : '';
  const from = a.removed.length ? escapeHtml(a.removed.join(', ')) : '';
  const to = a.added.length ? escapeHtml(a.added.join(', ')) : '';
  switch (a.category) {
    case 'TagsCategory':
      if (a.added.length && !a.removed.length) return `added tag <b>${to}</b>`;
      if (a.removed.length && !a.added.length) return `removed tag <b>${from}</b>`;
      return `changed tags`;
    case 'LinksCategory':
      if (a.added.length && !a.removed.length) return `added link ${field ? field + ' ' : ''}<b>${to}</b>`;
      if (a.removed.length && !a.added.length) return `removed link ${field ? field + ' ' : ''}<b>${from}</b>`;
      return `changed links`;
    case 'AttachmentsCategory':
      if (a.added.length && !a.removed.length) return `attached <b>${to}</b>`;
      if (a.removed.length && !a.added.length) return `removed attachment <b>${from}</b>`;
      return `updated attachments`;
    case 'SummaryCategory':
      return `edited the summary`;
    case 'DescriptionCategory':
      return `edited the description`;
    case 'IssueCreatedCategory':
      return `created this issue`;
    case 'IssueResolvedCategory':
      return to ? `resolved as <b>${to}</b>` : `marked as unresolved`;
    case 'SprintCategory':
      if (a.added.length && !a.removed.length) return `added to sprint <b>${to}</b>`;
      if (a.removed.length && !a.added.length) return `removed from sprint <b>${from}</b>`;
      return `changed sprint`;
    case 'ProjectCategory':
      return `moved ${from ? `from <b>${from}</b> ` : ''}${to ? `to <b>${to}</b>` : ''}`;
    case 'VcsChangeCategory':
      if (to) return `pushed commit <b>${to}</b>`;
      return `pushed a commit`;
    case 'CustomFieldCategory':
    default: {
      if (from && to) return `changed ${field || 'a field'} from <b>${from}</b> to <b>${to}</b>`;
      if (to) return `set ${field || 'a field'} to <b>${to}</b>`;
      if (from) return `cleared ${field || 'a field'} (was <b>${from}</b>)`;
      return `updated ${field || 'a field'}`;
    }
  }
}

function renderEstimateBar(estSeconds: number, spentSeconds: number): string {
  if (!estSeconds || estSeconds <= 0) return '';
  // Fill width clamps at 100% (can't extend beyond the track); the label
  // shows the true percentage so users know how much over they are.
  const truePct = Math.round((spentSeconds / estSeconds) * 100);
  const fillPct = Math.min(100, truePct);
  const over = spentSeconds > estSeconds;
  const label = over
    ? `${formatPeriod(spentSeconds)} / ${formatPeriod(estSeconds)} · <b>+${truePct - 100}%</b>`
    : `${formatPeriod(spentSeconds)} / ${formatPeriod(estSeconds)} · ${truePct}%`;
  return `<div class="estimate-bar${over ? ' over' : ''}" title="${formatPeriod(spentSeconds)} of ${formatPeriod(estSeconds)}">
    <div class="estimate-fill${over ? ' over' : ''}" style="width:${fillPct}%"></div>
    <div class="estimate-label">${label}</div>
  </div>`;
}

function renderSideField(f: CustomField, ctx?: { spentSeconds?: number }): string {
  const v = f.value;
  const name = escapeHtml(f.name);
  if (f.name === 'State' && (v.kind === 'state' || v.kind === 'enum')) {
    const vis = stateVisuals(v.name);
    // Prefer the YouTrack-configured bundle color so the pill icon matches
    // what the YouTrack web UI shows; fall back to the shape's theme color.
    const ytBg = v.color?.background;
    const color = ytBg
      ? `color:${escapeHtml(ytBg)}`
      : (vis.color ? `color:var(--vscode-${vis.color.replace(/\./g, '-')})` : '');
    return `<div class="side-field editable-pill" data-pill="changeState" data-inline-kind="state" title="Click to change state"><span class="label">${name}</span><span class="value icon-label"><i class="codicon codicon-${vis.icon}" style="${color}"></i>${escapeHtml(v.name)}</span></div>`;
  }
  if (f.name === 'Priority' && v.kind === 'enum') {
    const bg = v.color?.background ? escapeHtml(v.color.background) : 'var(--vscode-descriptionForeground)';
    return `<div class="side-field editable-pill" data-pill="changePriority" data-inline-kind="priority" title="Click to change priority"><span class="label">${name}</span><span class="value icon-label"><span class="ip-dot" style="background:${bg}"></span>${escapeHtml(v.name)}</span></div>`;
  }
  if (v.kind === 'user') {
    const isAssignee = f.name === 'Assignee';
    const pillAttrs = isAssignee
      ? `data-pill="changeAssignee" data-inline-kind="user" data-field-name="Assignee" data-allow-clear="1" data-clear-label="Unassign"`
      : `data-pill="editField" data-inline-kind="user" data-field-name="${escapeHtml(f.name)}" data-allow-clear="1" data-clear-label="Clear ${name}"`;
    return `<div class="side-field editable-pill" ${pillAttrs} title="Click to change ${isAssignee ? 'assignee' : name}"><span class="label">${name}</span><span class="value">${renderUserChip({ id: '', login: v.login, fullName: v.fullName, avatarUrl: v.avatarUrl })}</span></div>`;
  }
  if (f.name === 'Assignee' && v.kind === 'empty') {
    return `<div class="side-field editable-pill" data-pill="changeAssignee" data-inline-kind="user" data-field-name="Assignee" data-allow-clear="1" data-clear-label="Unassign" title="Click to assign"><span class="label">${name}</span><span class="value"><em>Unassigned</em></span></div>`;
  }
  // Generic editable: any remaining field becomes a pill that opens the
  // editCustomField dispatcher keyed off the field type.
  // `unknown`-typed fields that were promoted to kind='date' by the
  // epoch-ms heuristic should still be editable as dates.
  const isPromotedDate = f.type === 'unknown' && v.kind === 'date';
  if (f.type !== 'unknown' || isPromotedDate) {
    const valueHtml = v.kind === 'empty'
      ? `<em>—</em>`
      : escapeHtml(valueAsText(v, f.type));
    const isEstimation = /estim/i.test(f.name) && v.kind === 'period';
    const bar = isEstimation && v.kind === 'period'
      ? renderEstimateBar(v.seconds, ctx?.spentSeconds ?? 0)
      : '';
    // Every editable field type gets an inline-kind so the webview
    // anchors a dropdown (picker or input) directly under the pill.
    // Raw values are surfaced via data attributes so the input can
    // pre-fill. Name-based hints catch fields YouTrack returns as
    // Simple/int with epoch-ms values but that users clearly think of
    // as dates ("End date", "Start date", "Due date", "Timer time"…).
    const DATEY_NAME = /(^|\s)(date|time|deadline|due|started?|ended?|finished?|completed?|created|updated|scheduled)(\s|$)/i;
    const namedAsDate = DATEY_NAME.test(f.name);
    let inlineKind: string;
    // Order matters: explicit server types win over name heuristics, so
    // a field called "Timer time" that's actually a period stays a period.
    if (f.type === 'enum' || f.type === 'version') inlineKind = 'enum';
    else if (f.type === 'state') inlineKind = 'state';
    else if (f.type === 'bool') inlineKind = 'bool';
    else if (f.type === 'period') inlineKind = 'period';
    else if (f.type === 'datetime') inlineKind = 'datetime';
    else if (f.type === 'date') inlineKind = 'date';
    else if (f.type === 'string') inlineKind = 'string';
    else if (v.kind === 'date') inlineKind = 'date';
    else if (namedAsDate && (f.type === 'int' || f.type === 'float' || f.type === 'unknown')) inlineKind = 'date';
    else if (f.type === 'int') inlineKind = 'int';
    else if (f.type === 'float') inlineKind = 'float';
    else inlineKind = '';
    let rawValueAttr = '';
    if (v.kind === 'date' && v.iso) {
      const d = new Date(v.iso);
      if (inlineKind === 'datetime') {
        const pad = (n: number) => String(n).padStart(2, '0');
        const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        rawValueAttr = ` data-raw-value="${escapeHtml(local)}"`;
      } else {
        rawValueAttr = ` data-raw-value="${escapeHtml(d.toISOString().slice(0, 10))}"`;
      }
    }
    else if (v.kind === 'period' && v.seconds) rawValueAttr = ` data-raw-value="${escapeHtml(formatPeriod(v.seconds))}"`;
    else if (v.kind === 'string' && v.text) rawValueAttr = ` data-raw-value="${escapeHtml(v.text)}"`;
    else if (v.kind === 'number') {
      // A date-like name with a numeric epoch-ms value becomes the date
      // picker's default; otherwise pass the number through as-is.
      if (inlineKind === 'date' && typeof v.value === 'number' && v.value > 1_000_000_000_000) {
        rawValueAttr = ` data-raw-value="${escapeHtml(new Date(v.value).toISOString().slice(0, 10))}"`;
      } else {
        rawValueAttr = ` data-raw-value="${escapeHtml(String(v.value ?? ''))}"`;
      }
    }
    else if (v.kind === 'bool') rawValueAttr = ` data-raw-value="${v.value ? '1' : '0'}"`;
    const allowClear = inlineKind === 'date' || inlineKind === 'datetime' || inlineKind === 'period'
      || inlineKind === 'string' || inlineKind === 'int' || inlineKind === 'float';
    const inlineAttrs = inlineKind
      ? ` data-inline-kind="${inlineKind}"${rawValueAttr}${allowClear ? ' data-allow-clear="1"' : ''}${allowClear ? ` data-clear-label="Clear ${escapeHtml(f.name)}"` : ''}`
      : '';
    return `<div class="side-field editable-pill" data-pill="editField" data-field-name="${escapeHtml(f.name)}"${inlineAttrs} title="Click to edit ${name}"><span class="label">${name}</span><span class="value">${valueHtml}${bar}</span></div>`;
  }
  return `<div class="side-field"><span class="label">${name}</span><span class="value">${escapeHtml(valueAsText(v, f.type))}</span></div>`;
}

export class IssueDetailPanel {
  private static panels = new Map<string, IssueDetailPanel>();
  private panel: vscode.WebviewPanel;
  private workTypes: Array<{ id: string; name: string }> = [];
  private userLookup = new Map<string, User>();
  private currentUserLogin = '';
  private sortDir: 'newest' | 'oldest' = 'newest';

  private constructor(
    private extensionUri: vscode.Uri,
    private client: YouTrackClient,
    private cache: Cache,
    private issueId: string,
    private context: vscode.ExtensionContext,
    opts?: { beside?: boolean; preserveFocus?: boolean },
  ) {
    const column = opts?.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
    this.panel = vscode.window.createWebviewPanel(
      'youtrackIssue', issueId,
      { viewColumn: column, preserveFocus: !!opts?.preserveFocus },
      { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), context.globalStorageUri], retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'youtrack.png');
    this.sortDir = context.globalState.get<'newest' | 'oldest'>('youtrack.activitySort', 'newest');
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => IssueDetailPanel.panels.delete(issueId));
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
  }

  static show(
    extensionUri: vscode.Uri,
    client: YouTrackClient,
    cache: Cache,
    issueId: string,
    context: vscode.ExtensionContext,
    opts?: { beside?: boolean; preserveFocus?: boolean },
  ): void {
    const existing = IssueDetailPanel.panels.get(issueId);
    if (existing) {
      existing.panel.reveal(
        opts?.beside ? vscode.ViewColumn.Beside : undefined,
        !!opts?.preserveFocus,
      );
      return;
    }
    const p = new IssueDetailPanel(extensionUri, client, cache, issueId, context, opts);
    IssueDetailPanel.panels.set(issueId, p);
  }

  private draftKey(scope: string): string {
    return `youtrack.draft.${this.issueId}.${scope}`;
  }

  private getDraft(scope: string): string {
    return this.context.globalState.get<string>(this.draftKey(scope), '');
  }

  private async setDraft(scope: string, text: string): Promise<void> {
    const key = this.draftKey(scope);
    if (text) await this.context.globalState.update(key, text);
    else await this.context.globalState.update(key, undefined);
  }

  private shellHtml(): string {
    return renderPanelHtml(this.panel.webview, this.extensionUri, 'issueDetail');
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

    const [comments, attachments, workItems, activities, types, users, me] = await Promise.all([
      this.client.fetchComments(this.issueId).catch(() => [] as Comment[]),
      this.client.fetchAttachments(this.issueId).catch(() => [] as Attachment[]),
      this.client.fetchWorkItems(this.issueId).catch(() => [] as WorkItem[]),
      this.client.fetchIssueActivities(this.issueId).catch(() => [] as Awaited<ReturnType<typeof this.client.fetchIssueActivities>>),
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

    this.panel.webview.postMessage({ type: 'render', html: this.renderHtml(issue, comments, attachments, workItems, activities) });
    // Ship the user directory to the webview so inline @-autocomplete
    // can run against it without round-tripping to the extension.
    const userRoster = [...this.userLookup.values()].map((u) => ({
      login: u.login, fullName: u.fullName || u.login, avatarUrl: u.avatarUrl || '',
    }));
    this.panel.webview.postMessage({ type: 'userRoster', users: userRoster });
  }

  private renderHtml(
    issue: Issue,
    comments: Comment[],
    attachments: Attachment[],
    workItems: WorkItem[],
    activities: Array<{ id: string; timestamp: number; category: string; field?: string; added: string[]; removed: string[]; author: User }> = [],
  ): string {
    const spentSeconds = workItems.reduce((sum, w) => sum + (w.duration || 0), 0);
    // Issue-level attachment lookup, built once and reused for every
    // renderBody call below (description, comments, work items).
    const issueByName = buildAttachmentByName(attachments);
    const sideFields = issue.customFields.map((f) => renderSideField(f, { spentSeconds })).join('');
    const projectRow = `<div class="side-field"><span class="label">Project</span><span class="value">${escapeHtml(issue.project.shortName)}</span></div>`;
    const reporterRow = issue.reporter
      ? `<div class="side-field"><span class="label">Reporter</span><span class="value">${renderUserChip(issue.reporter)}</span></div>`
      : '';
    const currentTagIds = issue.tags.map((t) => t.id).join(',');
    const tagsRow = `<div class="side-field editable-pill" data-pill="editTags" data-inline-kind="tags" data-current-ids="${escapeHtml(currentTagIds)}" title="Click to edit tags"><span class="label">Tags</span><span class="value tags-value">${
      issue.tags.length ? issue.tags.map(renderTag).join('') : '<span class="muted">Click to add…</span>'
    }</span></div>`;
    const linkRowsHtml = issue.links.length
      ? issue.links.map((link: IssueLink) => {
          const chips = link.issues.map((i) => `<a class="link-chip${i.resolved ? ' resolved' : ''}" data-open-issue="${escapeHtml(i.idReadable)}" title="${escapeHtml(i.summary)}">${escapeHtml(i.idReadable)}</a>`).join('');
          return `<div class="side-field side-link-row"><span class="label">${escapeHtml(link.name)}</span><span class="value link-chips">${chips}</span></div>`;
        }).join('')
      : '';
    const existingLinksJson = JSON.stringify(issue.links.flatMap((l) =>
      l.issues.map((i) => ({ verb: l.name, targetId: i.idReadable, targetSummary: i.summary })),
    ));
    const linksRows = `${linkRowsHtml}<div class="side-field editable-pill" data-pill="manageLinks" data-inline-kind="links" data-existing-links='${escapeHtml(existingLinksJson)}' title="Click to add or remove links"><span class="label">Links</span><span class="value"><span class="muted icon-label"><i class="codicon codicon-link"></i>Manage…</span></span></div>`;

    const attachHtml = attachments.map((a) => renderAttachmentTile(a)).join('');

    // Subtasks — children linked via the "subtask of" / "parent for"
    // relationship. YouTrack's link direction is OUTWARD from this
    // issue when it's the parent; the link name varies by workspace
    // ("parent for" / "subtask" / etc.) so we match on common patterns.
    const subtaskLink = issue.links.find((l) => /parent for|subtask/i.test(l.name) && l.direction !== 'INWARD');
    const subtasks = subtaskLink?.issues ?? [];
    const subtasksDone = subtasks.filter((i) => i.resolved).length;
    const subtasksPct = subtasks.length ? Math.round((subtasksDone / subtasks.length) * 100) : 0;
    const subtasksHtml = subtasks.length ? `
      <div class="section">
        <div class="section-head">
          <h3><i class="codicon codicon-type-hierarchy-sub"></i>Subtasks <span class="muted count">(${subtasksDone} / ${subtasks.length})</span></h3>
          <span class="subtask-progress" title="${subtasksDone} of ${subtasks.length} resolved · ${subtasksPct}%">
            <span class="subtask-progress-track"><span class="subtask-progress-fill" style="width:${subtasksPct}%"></span></span>
          </span>
        </div>
        <div class="subtasks-list">
          ${subtasks.map((i) => `
            <a class="subtask-row${i.resolved ? ' resolved' : ''}" data-open-issue="${escapeHtml(i.idReadable)}" title="${escapeHtml(i.summary)}">
              <i class="codicon codicon-${i.resolved ? 'pass-filled' : 'circle-large-outline'}"></i>
              <span class="subtask-id">${escapeHtml(i.idReadable)}</span>
              <span class="subtask-summary">${escapeHtml(i.summary)}</span>
            </a>
          `).join('')}
        </div>
      </div>` : '';

    type Entry = { ts: number; html: string };
    const commentEntries: Entry[] = [];
    const historyEntries: Entry[] = [];
    for (const c of comments) {
      const isMine = !!c.author?.login && c.author.login === this.currentUserLogin;
      const editForm = isMine ? `
            <form class="comment-edit md-form" data-comment-id="${escapeHtml(c.id)}" hidden>
              ${formattingToolbarHtml()}
              <textarea name="text" required>${escapeHtml(c.text)}</textarea>
              <div class="md-preview md-body" hidden></div>
              <div class="edit-actions">
                <button type="submit" class="btn primary">Save</button>
                <button type="button" class="btn" data-comment-edit-cancel>Cancel</button>
              </div>
            </form>` : '';
      const editBtn = isMine ? `<button type="button" class="comment-edit-btn" data-edit-comment="${escapeHtml(c.id)}" title="Edit"><i class="codicon codicon-edit"></i></button>` : '';
      const reactBtn = `<button type="button" class="comment-react-btn" data-react-comment="${escapeHtml(c.id)}" title="Add reaction"><i class="codicon codicon-smiley"></i></button>`;
      const reactionsHtml = renderReactionChips(c.id, c.reactions, this.currentUserLogin);
      // Resolve refs against BOTH the global list and the comment's own
      // attachment list. Extra attachments that came with this comment but
      // aren't referenced from its markdown get rendered as tiles below.
      // For renderBody: start from issue-level map then overlay the
      // comment's own attachments (comment-bound ones win if there's
      // a name collision).
      const commentByName = new Map(issueByName);
      for (const a of c.attachments) commentByName.set(a.name.toLowerCase(), a.url);
      const refNames = new Set<string>();
      const refRe = /!?\[[^\]]*\]\(([^)\s]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = refRe.exec(c.text || '')) !== null) {
        const url = match[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.includes('/')) continue;
        try { refNames.add(decodeURIComponent(url).toLowerCase()); } catch { refNames.add(url.toLowerCase()); }
      }
      const unreferenced = c.attachments.filter((a) => !refNames.has(a.name.toLowerCase()));
      const tilesHtml = unreferenced.length
        ? `<div class="attachment-grid comment-attachments">${unreferenced.map((a) => renderAttachmentTile(a)).join('')}</div>`
        : '';
      const fullWhen = escapeHtml(new Date(c.created).toLocaleString());
      const relWhen = escapeHtml(formatRelative(c.created));
      commentEntries.push({
        ts: c.created,
        html: `
          <div class="activity-entry comment" data-activity-comment="${escapeHtml(c.id)}">
            <div class="entry-gutter">${renderAvatar(c.author)}</div>
            <div class="entry-content">
              <div class="entry-header">
                <b class="entry-author">${escapeHtml(c.author?.fullName ?? c.author?.login ?? '')}</b>
                <span class="entry-verb">commented</span>
                <span class="entry-time" title="${fullWhen}">${relWhen}</span>
                ${c.restricted ? `<span class="visibility-badge" title="Visible to ${escapeHtml(c.visibilityLabel)}"><i class="codicon codicon-lock"></i>${escapeHtml(c.visibilityLabel)}</span>` : ''}
                <span class="spacer"></span>${reactBtn}${editBtn}
              </div>
              <div class="body md-body comment-view">${renderBody(c.text, this.userLookup, commentByName)}</div>
              ${tilesHtml}
              ${reactionsHtml}
              ${editForm}
            </div>
          </div>`,
      });
    }
    for (const w of workItems) {
      const dur = formatPeriod(w.duration);
      const typeLabel = w.type?.name ? ` · ${escapeHtml(w.type.name)}` : '';
      const fullWhen = escapeHtml(new Date(w.date).toLocaleString());
      const relWhen = escapeHtml(formatRelative(w.date));
      historyEntries.push({
        ts: w.date,
        html: `
          <div class="activity-entry work">
            <div class="entry-gutter">${renderAvatar(w.author)}</div>
            <div class="entry-content">
              <div class="entry-header">
                <b class="entry-author">${escapeHtml(w.author?.fullName ?? w.author?.login ?? '')}</b>
                <span class="entry-verb">logged <strong>${dur}</strong>${typeLabel}</span>
                <span class="entry-time" title="${fullWhen}">${relWhen}</span>
              </div>
              ${w.text ? `<div class="body">${renderBody(w.text, this.userLookup, issueByName)}</div>` : ''}
            </div>
          </div>`,
      });
    }
    for (const a of activities) {
      const fullWhen = escapeHtml(new Date(a.timestamp).toLocaleString());
      const relWhen = escapeHtml(formatRelative(a.timestamp));
      historyEntries.push({
        ts: a.timestamp,
        html: `
          <div class="activity-entry change">
            <div class="entry-gutter">${renderAvatar(a.author)}</div>
            <div class="entry-content">
              <div class="entry-header">
                <b class="entry-author">${escapeHtml(a.author?.fullName ?? a.author?.login ?? '')}</b>
                <span class="entry-verb">${renderChangeVerb(a)}</span>
                <span class="entry-time" title="${fullWhen}">${relWhen}</span>
              </div>
            </div>
          </div>`,
      });
    }
    const cmp = this.sortDir === 'oldest'
      ? (a: Entry, b: Entry) => a.ts - b.ts
      : (a: Entry, b: Entry) => b.ts - a.ts;
    commentEntries.sort(cmp);
    historyEntries.sort(cmp);
    const commentsHtml = commentEntries.length
      ? commentEntries.map((e) => e.html).join('')
      : '<div style="color:var(--vscode-descriptionForeground);font-style:italic;padding:0.5rem 0">No comments yet.</div>';
    const historyHtml = historyEntries.length
      ? historyEntries.map((e) => e.html).join('')
      : '<div style="color:var(--vscode-descriptionForeground);font-style:italic;padding:0.5rem 0">No activity yet.</div>';
    const historyCount = historyEntries.length;

    void this.workTypes; // list fetched on demand by the inline picker

    const descriptionBody = issue.description
      ? `<div class="description md-body">${renderBody(issue.description, this.userLookup, issueByName)}</div>`
      : `<div class="description empty">No description.</div>`;

    return `
      <div class="layout">
        <div class="main">
          <div class="header">
            <div class="id-row"><span class="id">${escapeHtml(issue.idReadable)}</span><span class="sep">·</span><span>${escapeHtml(issue.project.shortName)}</span></div>
            <div class="editable" data-field="summary">
              <div class="editable-view">
                <div class="summary">${escapeHtml(issue.summary)}</div>
                <button class="edit-btn" data-edit="summary" title="Edit summary"><i class="codicon codicon-edit"></i></button>
              </div>
              <form class="editable-edit summary-edit" data-edit-form="summary" hidden>
                <input type="text" name="text" value="${escapeHtml(issue.summary)}" required>
                <div class="edit-actions">
                  <button type="submit" class="btn primary">Save</button>
                  <button type="button" class="btn" data-edit-cancel="summary">Cancel</button>
                </div>
              </form>
            </div>
            <div class="toolbar">
              <button class="btn primary" data-cmd="startWork" title="Transition state and create a branch"><i class="codicon codicon-play"></i>Start Work</button>
              <button class="btn" data-cmd="startTimer" title="Start a timer on this issue"><i class="codicon codicon-clock"></i>Timer</button>
              <button class="btn" data-cmd="createBranch" title="Create git branch from issue"><i class="codicon codicon-git-branch"></i>Branch</button>
              <span class="toolbar-gap"></span>
              <button class="btn icon" data-cmd="refresh" title="Refresh this issue"><i class="codicon codicon-refresh"></i></button>
              <button class="btn icon" data-cmd="copyLink" title="Copy issue link"><i class="codicon codicon-link"></i></button>
              <button class="btn icon" data-cmd="openInBrowser" title="Open in browser"><i class="codicon codicon-link-external"></i></button>
            </div>
            <div class="editable" data-field="description">
              <div class="editable-view">
                ${descriptionBody}
                <button class="edit-btn edit-btn-floating" data-edit="description" title="Edit description"><i class="codicon codicon-edit"></i></button>
              </div>
              <form class="editable-edit description-edit md-form" data-edit-form="description" hidden>
                ${formattingToolbarHtml()}
                <textarea name="text" placeholder="Markdown supported">${escapeHtml(issue.description)}</textarea>
                <div class="md-preview md-body" hidden></div>
                <div class="edit-actions">
                  <button type="submit" class="btn primary">Save</button>
                  <button type="button" class="btn" data-edit-cancel="description">Cancel</button>
                </div>
              </form>
            </div>
          </div>
          ${subtasksHtml}
          <div class="section">
            <div class="section-head">
              <h3><i class="codicon codicon-file-media"></i>Attachments</h3>
              <button type="button" class="btn" data-attach-pick><i class="codicon codicon-cloud-upload"></i> Attach</button>
            </div>
            ${attachments.length
              ? `<div class="attachment-grid">${attachHtml}</div>`
              : `<div class="attachment-empty">No attachments yet. Click <b>Attach</b> or drop files anywhere on this panel.</div>`}
            <input type="file" data-attach-input multiple hidden>
          </div>
          <div class="section">
            <div class="section-head">
              <h3><i class="codicon codicon-comment-discussion"></i>Comments</h3>
              <button type="button" class="btn ghost sort-toggle" data-sort-toggle title="Toggle sort order">
                <i class="codicon codicon-${this.sortDir === 'oldest' ? 'arrow-up' : 'arrow-down'}"></i>
                ${this.sortDir === 'oldest' ? 'Oldest first' : 'Newest first'}
              </button>
            </div>
            ${commentsHtml}
            <button type="button" class="btn inline-toggle" data-inline-toggle="comment"><i class="codicon codicon-add"></i><span class="toggle-label">Add a comment</span></button>
            <form class="add-comment md-form${this.getDraft('addComment') ? '' : ' collapsed'}" data-collapsible="comment">
              ${formattingToolbarHtml()}
              <textarea name="text" data-draft-scope="addComment" placeholder="Write a comment... (markdown supported)">${escapeHtml(this.getDraft('addComment'))}</textarea>
              <div class="md-preview md-body" hidden></div>
              <div class="queued-attachments attachment-grid" hidden></div>
              <button type="submit" class="btn primary">Post Comment</button>
            </form>
          </div>
          <details class="section activity-section">
            <summary><h3><i class="codicon codicon-history"></i>Activity${historyCount ? ` <span class="muted count">(${historyCount})</span>` : ''}</h3></summary>
            ${historyHtml}
          </details>
          <div class="section">
            <h3><i class="codicon codicon-clock"></i>Log time</h3>
            <button type="button" class="btn inline-toggle" data-inline-toggle="logtime"><i class="codicon codicon-add"></i><span class="toggle-label">Add spent time</span></button>
            <form class="log-time collapsed" data-collapsible="logtime">
              <label>Duration</label><input name="duration" placeholder="1h30m" required>
              <label>Date</label><input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required>
              <label>Type</label>
              <button type="button" class="btn type-pick editable-pill" data-work-type-pick data-work-type-id="" title="Click to pick a type"><span class="muted">(no type)</span></button>
              <input type="hidden" name="type" value="">
              <label>Note</label><input name="text" placeholder="optional">
              <button type="submit" class="btn primary">Log</button>
            </form>
          </div>
        </div>
        <aside class="side">
          <h4><i class="codicon codicon-info"></i>Details</h4>
          ${projectRow}
          ${reporterRow}
          ${sideFields}
          ${tagsRow}
          ${linksRows}
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
        showYouTrackError(e, 'log time');
      }
      return;
    }
    if (msg.type === 'addComment') {
      const text = String(msg.text ?? '').trim();
      const files: Array<{ name: string; mime: string; dataBase64: string }> =
        Array.isArray(msg.files) ? msg.files : [];
      if (!text && !files.length) return;
      try {
        // Create the comment first (text only), then upload each queued
        // file to the comment's own /attachments endpoint so YouTrack
        // binds them to the comment (they render as tiles below it,
        // matching the web UI — never inlined as markdown).
        const created = await this.client.addComment(this.issueId, text || ' ');
        for (const f of files) {
          try {
            const bytes = Buffer.from(String(f.dataBase64 ?? ''), 'base64');
            await this.client.uploadAttachmentToComment(
              this.issueId, created.id,
              String(f.name ?? 'file'), bytes, String(f.mime ?? 'application/octet-stream'),
            );
          } catch (e) {
            showYouTrackError(e, 'attach to comment', 'warning');
          }
        }
        await this.setDraft('addComment', '');
        await this.reload();
      } catch (e) {
        showYouTrackError(e, 'add comment');
      }
      return;
    }
    if (msg.type === 'saveDraft') {
      const scope = String(msg.scope ?? '').replace(/[^A-Za-z0-9_\-:]/g, '_');
      if (!scope) return;
      await this.setDraft(scope, String(msg.text ?? ''));
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
        showYouTrackError(e, 'update comment');
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
        showYouTrackError(e, 'update issue');
      }
      return;
    }
    if (msg.type === 'pickMention') {
      try {
        const users = await this.client.listUsers('', 50);
        await primeUserAvatars(users.map((u) => u.avatarUrl));
        const picked = await vscode.window.showQuickPick(
          users.map((u) => ({
            label: u.fullName || u.login,
            description: u.login,
            login: u.login,
            iconPath: userAvatarUri(u.avatarUrl) ?? new vscode.ThemeIcon('person'),
          })),
          { placeHolder: 'Mention a user', matchOnDescription: true, ignoreFocusOut: true },
        );
        if (picked) this.panel.webview.postMessage({ type: 'insertMention', login: picked.login });
      } catch (e) {
        showYouTrackError(e, `couldn't load users`);
      }
      return;
    }
    if (msg.type === 'openInlinePicker') {
      try {
        const issue = await this.cache.getIssue(this.issueId, (id) => this.client.fetchIssue(id));
        const projectId = issue.project.id;
        const req = {
          requestId: String(msg.requestId),
          kind: msg.kind,
          fieldName: msg.fieldName,
          projectId,
          allowClear: !!msg.allowClear,
          clearLabel: msg.clearLabel,
          currentIds: Array.isArray(msg.currentIds) ? msg.currentIds.map(String) : undefined,
          existingLinks: Array.isArray(msg.existingLinks) ? msg.existingLinks : undefined,
        };
        const payload = await buildPickerItems(this.client, this.panel.webview, req);
        this.panel.webview.postMessage({ type: 'inlinePickerItems', requestId: req.requestId, ...payload });
      } catch (e) {
        showYouTrackError(e, 'load options');
      }
      return;
    }
    if (msg.type === 'toggleIssueTag') {
      try {
        if (msg.picked) await this.client.addTagToIssue(this.issueId, String(msg.tagId));
        else await this.client.removeTagFromIssue(this.issueId, String(msg.tagId));
      } catch (e) {
        showYouTrackError(e, 'toggle tag');
      }
      return;
    }
    if (msg.type === 'createAndAttachTag') {
      const name = await vscode.window.showInputBox({
        title: 'Create new tag',
        prompt: 'Tag name',
        validateInput: (v) => (v.trim() ? undefined : 'Name required'),
      });
      if (!name || !name.trim()) return;
      try {
        const tag = await this.client.createTag(name.trim());
        await this.client.addTagToIssue(this.issueId, tag.id);
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        showYouTrackError(e, 'create tag');
      }
      return;
    }
    if (msg.type === 'reloadIssue') {
      this.cache.invalidateIssue(this.issueId);
      await this.reload();
      return;
    }
    if (msg.type === 'showKeyboardHelp') {
      vscode.window.showInformationMessage(
        'YouTrack panel shortcuts: C — focus add comment · R — toggle sort · E — edit description · ? — this help',
      );
      return;
    }
    if (msg.type === 'addCommentReaction') {
      try {
        await this.client.addCommentReaction(this.issueId, String(msg.commentId), String(msg.reaction));
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        showYouTrackError(e, 'add reaction');
      }
      return;
    }
    if (msg.type === 'removeCommentReaction') {
      try {
        await this.client.removeCommentReaction(this.issueId, String(msg.commentId), String(msg.reactionId));
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        showYouTrackError(e, 'remove reaction');
      }
      return;
    }
    if (msg.type === 'pickReaction') {
      const commentId = String(msg.commentId ?? '');
      if (!commentId) return;
      type Item = vscode.QuickPickItem & { reaction?: string };
      const items: Item[] = Object.entries(REACTION_EMOJI).map(([name, glyph]) => ({
        label: `${glyph}  ${name.replace(/-/g, ' ')}`,
        reaction: name,
      }));
      const picked = await vscode.window.showQuickPick<Item>(items, {
        title: 'Add reaction',
        placeHolder: 'Pick an emoji',
      });
      if (!picked?.reaction) return;
      try {
        await this.client.addCommentReaction(this.issueId, commentId, picked.reaction);
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        showYouTrackError(e, 'add reaction');
      }
      return;
    }
    if (msg.type === 'toggleActivitySort') {
      this.sortDir = this.sortDir === 'newest' ? 'oldest' : 'newest';
      await this.context.globalState.update('youtrack.activitySort', this.sortDir);
      await this.reload();
      return;
    }
    if (msg.type === 'removeIssueLink') {
      try {
        await this.client.runCommand([this.issueId], `remove ${String(msg.verb)} ${String(msg.targetId)}`);
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        showYouTrackError(e, 'remove link');
      }
      return;
    }
    if (msg.type === 'addIssueLink') {
      const target = await vscode.window.showInputBox({
        title: `Add link: ${String(msg.verb)}`,
        prompt: 'Target issue ID (e.g. ABC-123)',
        validateInput: (v) => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(v.trim()) ? undefined : 'Expected a YouTrack issue ID like ABC-123',
      });
      if (!target) return;
      try {
        await this.client.runCommand([this.issueId], `${String(msg.verb)} ${target.trim()}`);
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        showYouTrackError(e, 'add link');
      }
      return;
    }
    if (msg.type === 'applyInlinePick') {
      try {
        const kind = String(msg.kind);
        const fieldName = String(msg.fieldName ?? '');
        const rawValue = msg.valueId;
        const isClear = rawValue === '__clear__' || rawValue === null || rawValue === undefined;
        const strValue = isClear ? null : String(rawValue);
        if (kind === 'state') {
          if (!isClear) await this.client.transitionState(this.issueId, strValue!);
        } else if (kind === 'priority') {
          if (!isClear) await this.client.setPriority(this.issueId, strValue!);
          else await this.client.setCustomField(this.issueId, 'Priority', 'enum', null);
        } else if (kind === 'enum') {
          await this.client.setCustomField(this.issueId, fieldName, 'enum', strValue);
        } else if (kind === 'user') {
          if (fieldName === 'Assignee') await this.client.assignIssue(this.issueId, strValue ?? '');
          else await this.client.setCustomField(this.issueId, fieldName, 'user', strValue);
        } else if (kind === 'bool') {
          await this.client.setCustomField(this.issueId, fieldName, 'bool', strValue === '1');
        } else if (kind === 'string') {
          await this.client.setCustomField(this.issueId, fieldName, 'string', strValue);
        } else if (kind === 'date') {
          await this.client.setCustomField(this.issueId, fieldName, 'date', isClear ? null : Date.parse(strValue!));
        } else if (kind === 'datetime') {
          // HTML `datetime-local` gives "YYYY-MM-DDTHH:MM" without timezone;
          // Date.parse interprets it as local time, which is what the user
          // picked in their calendar.
          await this.client.setCustomField(this.issueId, fieldName, 'datetime', isClear ? null : Date.parse(strValue!));
        } else if (kind === 'period') {
          const seconds = isClear ? null : parseDuration(strValue!);
          if (!isClear && seconds == null) {
            vscode.window.showErrorMessage('YouTrack: could not parse duration.');
            return;
          }
          await this.client.setCustomField(this.issueId, fieldName, 'period', seconds);
        } else if (kind === 'int') {
          await this.client.setCustomField(this.issueId, fieldName, 'int', isClear ? null : Number(strValue));
        } else if (kind === 'float') {
          await this.client.setCustomField(this.issueId, fieldName, 'float', isClear ? null : Number(strValue));
        } else {
          vscode.window.showWarningMessage(`YouTrack: unsupported pick kind "${kind}" for ${fieldName}`);
          return;
        }
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
      } catch (e) {
        showYouTrackError(e, `apply ${msg.fieldName ?? msg.kind}`);
      }
      return;
    }
    if (msg.type === 'cmd') {
      if (msg.id === 'refresh') {
        this.cache.invalidateIssue(this.issueId);
        await this.reload();
        return;
      }
      if (msg.id === 'editField' && typeof msg.fieldName === 'string') {
        await vscode.commands.executeCommand('youtrack.editField', { id: this.issueId, field: msg.fieldName });
        await this.reload();
        return;
      }
      const map: Record<string, string> = {
        startWork: 'youtrack.startWork',
        assignToMe: 'youtrack.assignToMe',
        changeAssignee: 'youtrack.changeAssignee',
        changeState: 'youtrack.changeState',
        changePriority: 'youtrack.changePriority',
        editTags: 'youtrack.editTags',
        manageLinks: 'youtrack.manageLinks',
        logTime: 'youtrack.logTime',
        startTimer: 'youtrack.startTimer',
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
    if (msg.type === 'uploadAttachment') {
      try {
        const bytes = Buffer.from(String(msg.dataBase64 ?? ''), 'base64');
        const filename = String(msg.name ?? 'file');
        const mime = String(msg.mime ?? 'application/octet-stream');
        const mode = String(msg.mode ?? 'standalone'); // 'inline' | 'standalone'
        await this.client.uploadAttachment(this.issueId, filename, bytes, mime);
        if (mode === 'inline') {
          // Description / comment-edit: inline markdown makes sense
          // because those bodies are long-form markdown.
          this.cache.invalidateIssue(this.issueId);
          const list = await this.client.fetchAttachments(this.issueId).catch(() => []);
          const match = list.filter((a) => a.name === filename).pop();
          if (match) {
            const isImage = (match.mimeType ?? '').toLowerCase().startsWith('image/')
              || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(match.name);
            const md = isImage
              ? `![${filename}](${match.url})`
              : `[${filename}](${match.url})`;
            this.panel.webview.postMessage({ type: 'pasteInserted', markdown: md });
          }
        } else {
          vscode.window.showInformationMessage(`YouTrack: uploaded ${filename}`);
          await this.reload();
        }
      } catch (e) {
        showYouTrackError(e, 'attachment upload');
      }
      return;
    }
    if (msg.type === 'openLinkedIssue' && typeof msg.id === 'string') {
      vscode.commands.executeCommand('youtrack.openIssue', msg.id);
      return;
    }
  }
}
