import { request } from './request';
import type {
  Issue, User, Comment, Attachment, WorkItem, SavedQuery,
  CustomField, CustomFieldValue, CustomFieldType, Tag,
  AgileBoard, Sprint, BoardView, BoardColumn,
} from './types';

const ISSUE_FIELDS = [
  'id', 'idReadable', 'summary', 'description',
  'created', 'updated',
  'project(id,shortName)',
  'reporter(id,login,fullName,avatarUrl)',
  'tags(id,name,color(id,background,foreground))',
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
  if ($type.includes('EnumIssueCustomField')) return 'enum';
  if ($type.includes('StateIssueCustomField')) return 'state';
  if ($type.includes('SingleUserIssueCustomField')) return 'user';
  if ($type.includes('SimpleIssueCustomField')) return 'string';
  if ($type.includes('DateIssueCustomField')) return 'date';
  if ($type.includes('PeriodIssueCustomField')) return 'period';
  if ($type.includes('IntegerIssueCustomField')) return 'int';
  if ($type.includes('FloatIssueCustomField')) return 'float';
  if ($type.includes('BooleanIssueCustomField')) return 'bool';
  if ($type.includes('VersionIssueCustomField')) return 'version';
  return 'unknown';
}

function mapCustomField(raw: any, baseUrl?: string): CustomField {
  const type = inferType(raw.$type ?? '');
  return { name: raw.name, type, value: mapCustomFieldValue(raw.value, type, baseUrl) };
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
    customFields: rawFields.map((f) => mapCustomField(f, baseUrl)),
    tags: (raw.tags ?? []).map(mapTag),
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

  async listUsers(query = '', top = 30): Promise<User[]> {
    const raw = await this.call<any[]>('/api/users', {
      query: { query, $top: top, fields: 'id,login,fullName,avatarUrl' },
    });
    return raw.map((r) => mapUser(r, this.baseUrl)).filter((u): u is User => u !== null);
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
