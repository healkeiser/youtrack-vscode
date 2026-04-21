import { request } from './request';
import type {
  Issue, User, Comment, Attachment, WorkItem, SavedQuery,
  CustomField, CustomFieldValue, CustomFieldType, Tag, IssueLink,
  AgileBoard, Sprint, BoardView, BoardColumn,
} from './types';

const ISSUE_FIELDS = [
  'id', 'idReadable', 'summary', 'description',
  'created', 'updated', 'resolved',
  'project(id,shortName)',
  'reporter(id,login,fullName,avatarUrl)',
  'tags(id,name,color(id,background,foreground))',
  'links(direction,linkType(name,sourceToTarget,targetToSource),issues(idReadable,summary,resolved))',
  'customFields(name,$type,value(id,name,login,fullName,avatarUrl,text,presentation,minutes,color(id,background,foreground)))',
].join(',');

function mapUser(u: any, baseUrl?: string): User | null {
  if (!u) return null;
  let avatarUrl: string = u.avatarUrl ?? '';
  if (avatarUrl && baseUrl && !/^https?:/i.test(avatarUrl)) {
    const origin = baseUrl.replace(/\/+$/, '');
    avatarUrl = `${origin}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
  }
  return {
    id: u.id, login: u.login, fullName: u.fullName ?? u.login,
    avatarUrl,
  };
}

function mapCustomFieldValue(raw: any, type: CustomFieldType, baseUrl?: string): CustomFieldValue {
  if (raw === null || raw === undefined) return { kind: 'empty' };
  const color = raw.color ? { background: raw.color.background, foreground: raw.color.foreground } : undefined;
  switch (type) {
    case 'enum':    return { kind: 'enum', id: raw.id, name: raw.name, color };
    case 'state':   return { kind: 'state', id: raw.id, name: raw.name, color };
    case 'user':    {
      const u = mapUser(raw, baseUrl);
      return { kind: 'user', login: u?.login ?? raw.login ?? '', fullName: u?.fullName ?? raw.fullName ?? raw.login ?? '', avatarUrl: u?.avatarUrl ?? '' };
    }
    case 'string':  return { kind: 'string', text: String(raw.text ?? raw) };
    case 'date':    return { kind: 'date', iso: new Date(raw).toISOString() };
    case 'period':  return { kind: 'period', seconds: Number(raw.minutes ?? 0) * 60 };
    case 'int':
    case 'float':   return { kind: 'number', value: Number(raw) };
    case 'bool':    return { kind: 'bool', value: Boolean(raw) };
    case 'version': return { kind: 'version', name: raw.name };
    default:        return { kind: 'unknown', raw: JSON.stringify(raw) };
  }
}

function inferType($type: string): CustomFieldType {
  // Order matters: DateTime must be checked before Date (the latter is
  // a substring of the former), and Integer/Float/Boolean before Simple
  // (YouTrack wraps numeric and bool fields as SimpleIssueCustomField).
  if ($type.includes('EnumIssueCustomField')) return 'enum';
  if ($type.includes('StateIssueCustomField')) return 'state';
  if ($type.includes('SingleUserIssueCustomField')) return 'user';
  if ($type.includes('DateTimeIssueCustomField')) return 'date';
  if ($type.includes('DateIssueCustomField')) return 'date';
  if ($type.includes('PeriodIssueCustomField')) return 'period';
  if ($type.includes('IntegerIssueCustomField')) return 'int';
  if ($type.includes('FloatIssueCustomField')) return 'float';
  if ($type.includes('BooleanIssueCustomField')) return 'bool';
  if ($type.includes('VersionIssueCustomField')) return 'version';
  if ($type.includes('SimpleIssueCustomField')) return 'string';
  return 'unknown';
}

// Heuristic: YouTrack allows configuring a plain integer custom field to
// store timestamps (epoch ms). Those come back as IntegerIssueCustomField
// with a raw number — indistinguishable from a real numeric field by type
// alone. If the name *looks* like a date/time field AND the value is in
// the plausible epoch-ms range (roughly 2001-09-09 → 5138-11-16), render
// as a date. Kept intentionally narrow to avoid misclassifying real
// large-number integer fields.
const DATEY_NAME_RE = /(^|\s)(date|time|deadline|due|started?|ended?|finished?|completed?|created|updated|scheduled)(\s|$)/i;

function looksLikeEpochMs(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1_000_000_000_000 && n < 1e14;
}

function mapCustomField(raw: any, baseUrl?: string): CustomField {
  let type = inferType(raw.$type ?? '');
  let value = mapCustomFieldValue(raw.value, type, baseUrl);

  // Promote timestamp-shaped values whose field name suggests a date
  // into the `date` kind regardless of the classified type. YouTrack
  // reports these as IntegerIssueCustomField, SimpleIssueCustomField,
  // or (depending on how they were configured) the generic parent —
  // we can't rely on $type alone. What we can rely on: raw.value is a
  // plain number in epoch-ms range and the field name looks date-ish.
  // Keep `type` as 'unknown' to disable the generic field editor,
  // since the underlying schema is Integer and our date writer would
  // POST the wrong $type.
  const rawVal = raw.value;
  const candidate = typeof rawVal === 'number'
    ? rawVal
    : (typeof rawVal === 'string' && /^\d{12,14}$/.test(rawVal) ? Number(rawVal) : null);
  if (candidate != null
      && typeof raw.name === 'string'
      && DATEY_NAME_RE.test(raw.name)
      && looksLikeEpochMs(candidate)) {
    type = 'unknown';
    value = { kind: 'date', iso: new Date(candidate).toISOString() };
  }

  return { name: raw.name, type, value };
}

function extractAssignee(rawCustomFields: any[], baseUrl?: string): User | null {
  const field = rawCustomFields.find((f) => f?.name === 'Assignee');
  if (!field?.value) return null;
  return mapUser(field.value, baseUrl);
}

function mapTag(raw: any): Tag {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color ? {
      id: raw.color.id,
      background: raw.color.background,
      foreground: raw.color.foreground,
    } : null,
  };
}

function mapLinks(raw: any[]): IssueLink[] {
  const out: IssueLink[] = [];
  for (const l of raw ?? []) {
    const direction = l.direction ?? 'BOTH';
    const lt = l.linkType ?? {};
    const name = direction === 'OUTWARD'
      ? (lt.sourceToTarget ?? lt.name ?? 'relates to')
      : direction === 'INWARD'
      ? (lt.targetToSource ?? lt.name ?? 'relates to')
      : (lt.name ?? 'relates to');
    const issues = (l.issues ?? []).map((i: any) => ({
      idReadable: i.idReadable,
      summary: i.summary ?? '',
      resolved: i.resolved ?? null,
    }));
    if (issues.length) out.push({ direction, name, issues });
  }
  return out;
}

function mapIssue(raw: any, baseUrl?: string): Issue {
  const rawFields: any[] = raw.customFields ?? [];
  return {
    id: raw.id,
    idReadable: raw.idReadable,
    summary: raw.summary,
    description: raw.description ?? '',
    project: { id: raw.project.id, shortName: raw.project.shortName },
    reporter: mapUser(raw.reporter, baseUrl),
    assignee: extractAssignee(rawFields, baseUrl),
    created: raw.created,
    updated: raw.updated,
    resolved: raw.resolved ?? null,
    customFields: rawFields.map((f) => mapCustomField(f, baseUrl)),
    tags: (raw.tags ?? []).map(mapTag),
    links: mapLinks(raw.links ?? []),
  };
}

export class YouTrackClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private fetchImpl?: typeof fetch,
  ) {}

  private call<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    return request<T>({
      baseUrl: this.baseUrl, token: this.token, path, fetchImpl: this.fetchImpl,
      method: opts.method, body: opts.body, query: opts.query,
    });
  }

  async getMe(): Promise<User> {
    const raw = await this.call<any>('/api/users/me', { query: { fields: 'id,login,fullName,avatarUrl' } });
    return mapUser(raw, this.baseUrl)!;
  }

  async fetchIssue(idReadable: string): Promise<Issue> {
    const raw = await this.call<any>(`/api/issues/${idReadable}`, { query: { fields: ISSUE_FIELDS } });
    return mapIssue(raw, this.baseUrl);
  }

  async searchIssues(query: string, skip = 0, top = 50): Promise<Issue[]> {
    const raw = await this.call<any[]>('/api/issues', { query: { query, $skip: skip, $top: top, fields: ISSUE_FIELDS } });
    return raw.map((r) => mapIssue(r, this.baseUrl));
  }

  async searchSavedQueryIssues(savedQueryId: string, skip = 0, top = 50): Promise<Issue[]> {
    const raw = await this.call<any[]>('/api/issues', {
      query: { folder: savedQueryId, $skip: skip, $top: top, fields: ISSUE_FIELDS },
    });
    return raw.map((r) => mapIssue(r, this.baseUrl));
  }

  async fetchSavedQueries(): Promise<SavedQuery[]> {
    const raw = await this.call<any[]>('/api/savedQueries', { query: { fields: 'id,name,query' } });
    return raw.map((r) => ({ id: r.id, name: r.name, query: r.query ?? '' }));
  }

  async fetchNotifications(top = 50): Promise<Array<{ id: string; content: string; issue: { idReadable: string; summary: string } | null; sender: User | null; created: number; recipient: User | null; read: boolean }>> {
    const raw = await this.call<any[]>('/api/users/notifications', {
      query: { fields: 'id,content,read,sender(id,login,fullName,avatarUrl),issue(idReadable,summary),created,recipient(id,login,fullName,avatarUrl)', $top: top },
    }).catch(() => []);
    return raw.map((r) => ({
      id: r.id,
      content: r.content ?? '',
      issue: r.issue ? { idReadable: r.issue.idReadable, summary: r.issue.summary ?? '' } : null,
      sender: mapUser(r.sender, this.baseUrl),
      recipient: mapUser(r.recipient, this.baseUrl),
      created: r.created ?? 0,
      read: !!r.read,
    }));
  }

  async markNotificationRead(id: string, read = true): Promise<void> {
    await this.call<any>(`/api/users/notifications/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: { read },
      query: { fields: 'id,read' },
    });
  }

  async markAllNotificationsRead(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.markNotificationRead(id).catch(() => undefined)));
  }

  async downloadBytes(url: string): Promise<Uint8Array> {
    const res = await (this.fetchImpl ?? globalThis.fetch)(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async listUsers(query = '', top = 30): Promise<User[]> {
    const raw = await this.call<any[]>('/api/users', {
      query: { query, $top: top, fields: 'id,login,fullName,avatarUrl' },
    });
    return raw.map((r) => mapUser(r, this.baseUrl)).filter((u): u is User => u !== null);
  }

  async updateComment(issueId: string, commentId: string, text: string): Promise<Comment> {
    const raw = await this.call<any>(`/api/issues/${issueId}/comments/${commentId}`, {
      method: 'POST',
      query: { fields: 'id,text,created,author(id,login,fullName,avatarUrl)' },
      body: { text },
    });
    return {
      id: raw.id,
      text: raw.text ?? '',
      author: mapUser(raw.author, this.baseUrl) ?? { id: '', login: '', fullName: '', avatarUrl: '' },
      created: raw.created,
    };
  }

  async addComment(issueId: string, text: string): Promise<Comment> {
    const raw = await this.call<any>(`/api/issues/${issueId}/comments`, {
      method: 'POST',
      query: { fields: 'id,text,created,author(id,login,fullName,avatarUrl)' },
      body: { text },
    });
    return {
      id: raw.id,
      text: raw.text ?? '',
      author: mapUser(raw.author, this.baseUrl) ?? { id: '', login: '', fullName: '', avatarUrl: '' },
      created: raw.created,
    };
  }

  async fetchComments(issueId: string): Promise<Comment[]> {
    const raw = await this.call<any[]>(`/api/issues/${issueId}/comments`, {
      query: { fields: 'id,text,created,author(id,login,fullName,avatarUrl)' },
    });
    return raw.map((r) => ({ id: r.id, text: r.text ?? '', author: mapUser(r.author, this.baseUrl)!, created: r.created }));
  }

  async uploadAttachment(issueId: string, filename: string, bytes: Uint8Array, mimeType = 'application/octet-stream'): Promise<void> {
    const boundary = `----ytvsc-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, '\\"')}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(header);
    const footerBytes = encoder.encode(footer);
    const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
    body.set(headerBytes, 0);
    body.set(bytes, headerBytes.length);
    body.set(footerBytes, headerBytes.length + bytes.length);

    const url = `${this.baseUrl.replace(/\/$/, '')}/api/issues/${issueId}/attachments`;
    const res = await (this.fetchImpl ?? globalThis.fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  async fetchAttachments(issueId: string): Promise<Attachment[]> {
    const raw = await this.call<any[]>(`/api/issues/${issueId}/attachments`, {
      query: { fields: 'id,name,url,size,mimeType' },
    });
    return raw.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url.startsWith('http') ? r.url : `${this.baseUrl}${r.url}`,
      size: r.size,
      mimeType: r.mimeType,
    }));
  }

  async fetchWorkItems(issueId: string): Promise<WorkItem[]> {
    const raw = await this.call<any[]>(`/api/issues/${issueId}/timeTracking/workItems`, {
      query: { fields: 'id,duration(minutes),date,text,author(id,login,fullName,avatarUrl),type(id,name)' },
    });
    return raw.map((r) => ({
      id: r.id,
      author: mapUser(r.author, this.baseUrl)!,
      duration: Number(r.duration?.minutes ?? 0) * 60,
      date: r.date,
      type: r.type ? { id: r.type.id, name: r.type.name } : null,
      text: r.text ?? '',
    }));
  }

  async addWorkItem(issueId: string, input: { durationSeconds: number; date: number; typeId?: string; text?: string }): Promise<WorkItem> {
    const raw = await this.call<any>(`/api/issues/${issueId}/timeTracking/workItems`, {
      method: 'POST',
      query: { fields: 'id,duration(minutes),date,text,author(id,login,fullName,avatarUrl),type(id,name)' },
      body: {
        duration: { minutes: Math.round(input.durationSeconds / 60) },
        date: input.date,
        text: input.text ?? '',
        ...(input.typeId ? { type: { id: input.typeId } } : {}),
      },
    });
    return {
      id: raw.id,
      author: mapUser(raw.author, this.baseUrl)!,
      duration: Number(raw.duration?.minutes ?? 0) * 60,
      date: raw.date,
      type: raw.type ? { id: raw.type.id, name: raw.type.name } : null,
      text: raw.text ?? '',
    };
  }

  async listWorkItemTypes(): Promise<Array<{ id: string; name: string }>> {
    const raw = await this.call<any[]>('/api/admin/timeTrackingSettings/workItemTypes', {
      query: { fields: 'id,name' },
    });
    return raw.map((r) => ({ id: r.id, name: r.name }));
  }

  async updateIssueField(issueId: string, fieldName: string, value: unknown): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: { customFields: [{ name: fieldName, value }] },
    });
  }

  async updateIssue(issueId: string, patch: { summary?: string; description?: string }): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: patch,
    });
  }

  async assignIssue(issueId: string, login: string): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: {
        customFields: [{
          $type: 'SingleUserIssueCustomField',
          name: 'Assignee',
          value: { $type: 'User', login },
        }],
      },
    });
  }

  async transitionState(issueId: string, stateName: string): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: {
        customFields: [{
          $type: 'StateIssueCustomField',
          name: 'State',
          value: { $type: 'StateBundleElement', name: stateName },
        }],
      },
    });
  }

  async fetchProjectStateValues(projectId: string): Promise<string[]> {
    const raw = await this.call<any>(`/api/admin/projects/${projectId}/customFields`, {
      query: { fields: 'field(name),bundle(values(name))' },
    });
    const stateField = (raw as any[]).find((f) => f.field?.name === 'State');
    return stateField?.bundle?.values?.map((v: any) => v.name) ?? [];
  }

  async fetchProjectPriorityValues(projectId: string): Promise<string[]> {
    return this.fetchProjectFieldValues(projectId, 'Priority');
  }

  async fetchProjectFieldValues(projectId: string, fieldName: string): Promise<string[]> {
    const raw = await this.call<any>(`/api/admin/projects/${projectId}/customFields`, {
      query: { fields: 'field(name),bundle(values(name))' },
    });
    const field = (raw as any[]).find((f) => f.field?.name === fieldName);
    return field?.bundle?.values?.map((v: any) => v.name) ?? [];
  }

  async fetchProjectFieldValuesDetailed(
    projectId: string,
    fieldName: string,
  ): Promise<Array<{ name: string; color?: { background?: string; foreground?: string } }>> {
    const raw = await this.call<any>(`/api/admin/projects/${projectId}/customFields`, {
      query: { fields: 'field(name),bundle(values(name,color(background,foreground)))' },
    });
    const field = (raw as any[]).find((f) => f.field?.name === fieldName);
    return (field?.bundle?.values ?? []).map((v: any) => ({
      name: v.name,
      color: v.color ? { background: v.color.background, foreground: v.color.foreground } : undefined,
    }));
  }

  async setPriority(issueId: string, priorityName: string): Promise<void> {
    return this.setEnumField(issueId, 'Priority', priorityName);
  }

  async setEnumField(issueId: string, fieldName: string, value: string): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: {
        customFields: [{
          $type: 'SingleEnumIssueCustomField',
          name: fieldName,
          value: { $type: 'EnumBundleElement', name: value },
        }],
      },
    });
  }

  // Generic customField writer keyed off the schema $type discriminator.
  // `valueLiteral` uses the shape the caller's already normalized:
  //   - enum/state/version: the *name* (string)
  //   - user: the *login* (string), or null to clear
  //   - date: epoch ms (number), or null to clear
  //   - period: seconds (number)
  //   - string: the text
  //   - int/float: the number
  //   - bool: the boolean
  async setCustomField(
    issueId: string,
    fieldName: string,
    fieldType: 'enum' | 'state' | 'user' | 'string' | 'date' | 'period' | 'int' | 'float' | 'bool' | 'version',
    valueLiteral: string | number | boolean | null,
  ): Promise<void> {
    const cf: any = { name: fieldName };
    switch (fieldType) {
      case 'enum':
        cf.$type = 'SingleEnumIssueCustomField';
        cf.value = valueLiteral == null ? null : { $type: 'EnumBundleElement', name: String(valueLiteral) };
        break;
      case 'state':
        cf.$type = 'StateIssueCustomField';
        cf.value = valueLiteral == null ? null : { $type: 'StateBundleElement', name: String(valueLiteral) };
        break;
      case 'user':
        cf.$type = 'SingleUserIssueCustomField';
        cf.value = valueLiteral == null ? null : { $type: 'User', login: String(valueLiteral) };
        break;
      case 'version':
        cf.$type = 'SingleVersionIssueCustomField';
        cf.value = valueLiteral == null ? null : { $type: 'VersionBundleElement', name: String(valueLiteral) };
        break;
      case 'string':
        cf.$type = 'SimpleIssueCustomField';
        cf.value = valueLiteral == null ? null : String(valueLiteral);
        break;
      case 'date':
        cf.$type = 'DateIssueCustomField';
        cf.value = valueLiteral == null ? null : Number(valueLiteral);
        break;
      case 'period':
        cf.$type = 'PeriodIssueCustomField';
        cf.value = valueLiteral == null ? null : { $type: 'PeriodValue', minutes: Math.round(Number(valueLiteral) / 60) };
        break;
      case 'int':
        cf.$type = 'SimpleIssueCustomField';
        cf.value = valueLiteral == null ? null : Math.trunc(Number(valueLiteral));
        break;
      case 'float':
        cf.$type = 'SimpleIssueCustomField';
        cf.value = valueLiteral == null ? null : Number(valueLiteral);
        break;
      case 'bool':
        cf.$type = 'SimpleIssueCustomField';
        cf.value = !!valueLiteral;
        break;
    }
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: { customFields: [cf] },
    });
  }

  async listTags(top = 200): Promise<Tag[]> {
    const raw = await this.call<any[]>('/api/tags', {
      query: { fields: 'id,name,color(id,background,foreground)', $top: String(top) },
    });
    return raw.map((r) => mapTag(r));
  }

  async createTag(name: string): Promise<Tag> {
    const raw = await this.call<any>('/api/tags', {
      method: 'POST',
      query: { fields: 'id,name,color(id,background,foreground)' },
      body: { name },
    });
    return mapTag(raw);
  }

  async addTagToIssue(issueId: string, tagId: string): Promise<void> {
    await this.call(`/api/issues/${issueId}/tags`, {
      method: 'POST',
      query: { fields: 'id' },
      body: { id: tagId },
    });
  }

  async removeTagFromIssue(issueId: string, tagId: string): Promise<void> {
    await this.call(`/api/issues/${issueId}/tags/${tagId}`, { method: 'DELETE' });
  }

  async fetchAgileBoards(): Promise<AgileBoard[]> {
    const raw = await this.call<any[]>('/api/agiles', {
      query: { fields: 'id,name,projects(shortName)' },
    });
    return raw.map((r) => ({
      id: r.id, name: r.name,
      projects: (r.projects ?? []).map((p: any) => ({ shortName: p.shortName })),
    }));
  }

  async fetchSprints(boardId: string): Promise<Sprint[]> {
    const raw = await this.call<any[]>(`/api/agiles/${boardId}/sprints`, {
      query: { fields: 'id,name,archived,finish' },
    });
    const now = Date.now();
    return raw.map((r) => ({
      id: r.id, name: r.name,
      current: !r.archived && (!r.finish || r.finish > now),
    }));
  }

  async listProjects(): Promise<Array<{ id: string; shortName: string; name: string }>> {
    const raw = await this.call<any[]>('/api/admin/projects', { query: { fields: 'id,shortName,name' } });
    return raw.map((r) => ({ id: r.id, shortName: r.shortName, name: r.name }));
  }

  async createIssue(projectId: string, summary: string, description: string): Promise<{ idReadable: string }> {
    const raw = await this.call<any>('/api/issues', {
      method: 'POST',
      query: { fields: 'idReadable' },
      body: { project: { id: projectId }, summary, description },
    });
    return { idReadable: raw.idReadable };
  }

  async fetchBoardView(boardId: string, sprintId: string): Promise<BoardView> {
    const raw = await this.call<any>(`/api/agiles/${boardId}/sprints/${sprintId}/board`, {
      query: {
        fields: [
          'trimmedSwimlanes(id,cells(id,column(id),issues(' + ISSUE_FIELDS + ')))',
          'orphanRow(cells(id,column(id),issues(' + ISSUE_FIELDS + ')))',
          'columns(id,presentation,agileColumn(fieldValues(name)))',
        ].join(','),
      },
    });

    const columns: BoardColumn[] = (raw.columns ?? []).map((c: any) => ({
      id: c.id,
      name: c.presentation ?? '',
      states: (c.agileColumn?.fieldValues ?? []).map((v: any) => v.name),
    }));

    const issuesByColumn: Record<string, Issue[]> = Object.fromEntries(columns.map((c) => [c.id, []]));

    const allCells: any[] = [];
    if (raw.orphanRow?.cells) allCells.push(...raw.orphanRow.cells);
    for (const sl of raw.trimmedSwimlanes ?? []) {
      for (const cell of sl.cells ?? []) allCells.push(cell);
    }

    for (const cell of allCells) {
      const colId = cell.column?.id;
      if (!colId || !issuesByColumn[colId]) continue;
      for (const rawIssue of cell.issues ?? []) {
        issuesByColumn[colId].push(mapIssue(rawIssue, this.baseUrl));
      }
    }

    return { columns, issuesByColumn };
  }
}
