# ls-youtrack-vscode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code extension for YouTrack Cloud with sidebar, issue detail webview, time tracking, branch-from-issue, and an agile board.

**Architecture:** Thin TypeScript extension with a domain-pure `YouTrackClient` wrapping YouTrack's REST API, a `better-sqlite3` read-through cache, and VS Code UI surfaces (TreeView, webviews, commands, status bar). See `docs/superpowers/specs/2026-04-20-youtrack-vscode-extension-design.md`.

**Tech Stack:** TypeScript 5, Node 20, VS Code API 1.85+, `better-sqlite3`, `node-fetch`, `esbuild`, `vitest`, `@vscode/test-electron`, `@vscode/vsce`.

---

## File Structure

```
ls-youtrack-vscode/
  package.json                              Extension manifest + deps
  tsconfig.json                             Strict TS config
  esbuild.config.mjs                        Bundler config
  vitest.config.ts                          Unit test config
  .vscodeignore                             Files excluded from VSIX
  .gitignore
  README.md
  src/
    extension.ts                            activate/deactivate
    client/
      youtrackClient.ts                     REST wrapper
      types.ts                              Domain types
      request.ts                            fetch helper, retry, errors
    cache/
      cache.ts                              Read-through cache facade
      schema.ts                             SQLite schema + migrations
      lru.ts                                LRU eviction logic
      poller.ts                             Background polling loop
    auth/
      authStore.ts                          Token + baseUrl storage
    domain/
      branchNameBuilder.ts                  Pure template renderer
      timeTracker.ts                        Duration parsing + work item helpers
    ui/
      issueTreeProvider.ts                  Sidebar TreeDataProvider
      issueDetailPanel.ts                   Issue detail webview host
      agileBoardPanel.ts                    Agile board webview host
      fieldRenderer.ts                      Custom field HTML fragments
      statusBar.ts                          Status bar item
      uriHandler.ts                         ytrack:// handler
    commands/
      registry.ts                           Wires command IDs to handlers
      createIssue.ts
      search.ts
      goToIssue.ts
      assignToMe.ts
      changeState.ts
      logTime.ts
      createBranch.ts
      openBoard.ts
      signOut.ts
  media/
    issueDetail/                            Webview assets for detail panel
      index.html
      main.js
      style.css
    agileBoard/                             Webview assets for board
      index.html
      main.js
      style.css
  test/
    unit/
      branchNameBuilder.test.ts
      timeTracker.test.ts
      cache.test.ts
      fieldRenderer.test.ts
      request.test.ts
    integration/
      activation.test.ts
      commands.test.ts
  docs/
    QA.md
    superpowers/
      specs/
      plans/
  .github/
    workflows/
      release.yml                           Tag -> VSIX release
```

---

## Task 1: Bootstrap Node project

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.vscodeignore`, `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ls-youtrack-vscode",
  "displayName": "YouTrack for VS Code",
  "description": "YouTrack Cloud integration: sidebar, issue detail, time tracking, agile board, branch-from-issue.",
  "version": "0.1.0",
  "publisher": "lotchi-studio",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [],
    "configuration": {
      "title": "YouTrack",
      "properties": {}
    },
    "views": {},
    "viewsContainers": {}
  },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@vscode/test-electron": "^2.3.0",
    "@vscode/vsce": "^2.24.0",
    "esbuild": "^0.21.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "node-fetch": "^3.3.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
out/
*.vsix
.vscode-test/
.cache/
```

- [ ] **Step 4: Create `.vscodeignore`**

```
.vscode/**
.vscode-test/**
src/**
test/**
docs/**
**/*.ts
**/*.map
node_modules/**
!node_modules/better-sqlite3/**
tsconfig.json
esbuild.config.mjs
vitest.config.ts
.github/**
```

- [ ] **Step 5: Create `README.md`** (minimal stub)

```markdown
# ls-youtrack-vscode

VS Code extension for YouTrack Cloud.

See `docs/superpowers/specs/2026-04-20-youtrack-vscode-extension-design.md`.
```

- [ ] **Step 6: Install deps and commit**

```bash
npm install
git add package.json package-lock.json tsconfig.json .gitignore .vscodeignore README.md
git commit -m "[BUILD] Bootstrap Node project"
```

---

## Task 2: esbuild config and extension activation shell

**Files:**
- Create: `esbuild.config.mjs`, `src/extension.ts`

- [ ] **Step 1: Create `esbuild.config.mjs`**

```js
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'better-sqlite3'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: !watch,
});

if (watch) {
  await ctx.watch();
  console.log('esbuild: watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- [ ] **Step 2: Create minimal `src/extension.ts`**

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  console.log('ls-youtrack-vscode activated');
}

export function deactivate(): void {
  // noop
}
```

- [ ] **Step 3: Build to confirm**

Run: `npm run build`
Expected: produces `dist/extension.js` with no errors.

- [ ] **Step 4: Commit**

```bash
git add esbuild.config.mjs src/extension.ts
git commit -m "[BUILD] Add esbuild config and activation shell"
```

---

## Task 3: Vitest setup and first sanity test

**Files:**
- Create: `vitest.config.ts`, `test/unit/sanity.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Create `test/unit/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts test/unit/sanity.test.ts
git commit -m "[BUILD] Add vitest setup"
```

---

## Task 4: Domain types

**Files:**
- Create: `src/client/types.ts`

- [ ] **Step 1: Create `src/client/types.ts`**

```ts
export interface User {
  id: string;
  login: string;
  fullName: string;
  avatarUrl: string;
}

export interface CustomField {
  name: string;
  type: CustomFieldType;
  value: CustomFieldValue;
}

export type CustomFieldType =
  | 'enum'
  | 'user'
  | 'state'
  | 'string'
  | 'date'
  | 'period'
  | 'int'
  | 'float'
  | 'bool'
  | 'version'
  | 'unknown';

export type CustomFieldValue =
  | { kind: 'enum'; id: string; name: string }
  | { kind: 'user'; login: string; fullName: string }
  | { kind: 'state'; id: string; name: string }
  | { kind: 'string'; text: string }
  | { kind: 'date'; iso: string }
  | { kind: 'period'; seconds: number }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'version'; name: string }
  | { kind: 'unknown'; raw: string }
  | { kind: 'empty' };

export interface Issue {
  id: string;
  idReadable: string;
  summary: string;
  description: string;
  project: { id: string; shortName: string };
  reporter: User | null;
  assignee: User | null;
  created: number;
  updated: number;
  customFields: CustomField[];
}

export interface Comment {
  id: string;
  text: string;
  author: User;
  created: number;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface WorkItem {
  id: string;
  author: User;
  duration: number; // seconds
  date: number; // epoch ms
  type: { id: string; name: string } | null;
  text: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
}

export interface AgileBoard {
  id: string;
  name: string;
  projects: { shortName: string }[];
}

export interface Sprint {
  id: string;
  name: string;
  current: boolean;
}

export interface BoardColumn {
  id: string;
  name: string;
  states: string[];
}

export interface BoardView {
  columns: BoardColumn[];
  issuesByColumn: Record<string, Issue[]>;
}
```

- [ ] **Step 2: Confirm compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/types.ts
git commit -m "[FEAT] Add YouTrack domain types"
```

---

## Task 5: Request helper (TDD)

**Files:**
- Create: `src/client/request.ts`, `test/unit/request.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/request.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, HttpError } from '../../src/client/request';

function mockFetch(sequence: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const r = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response;
  });
  return { fn, calls };
}

describe('request', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns parsed body on 200', async () => {
    const { fn } = mockFetch([{ status: 200, body: { a: 1 } }]);
    const r = await request<{ a: number }>({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn });
    expect(r).toEqual({ a: 1 });
  });

  it('attaches bearer token', async () => {
    const fn = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{}',
    } as unknown as Response));
    await request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer t');
  });

  it('retries on 429 honoring Retry-After then succeeds', async () => {
    const { fn, calls } = mockFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: { ok: true } },
    ]);
    const r = await request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn });
    expect(r).toEqual({ ok: true });
    expect(calls.length).toBe(2);
  });

  it('throws HttpError on 4xx (non-429)', async () => {
    const { fn } = mockFetch([{ status: 404, body: { error: 'not found' } }]);
    await expect(request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn }))
      .rejects.toBeInstanceOf(HttpError);
  });

  it('retries once on 5xx then fails', async () => {
    const { fn, calls } = mockFetch([
      { status: 500 },
      { status: 500 },
    ]);
    await expect(request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn }))
      .rejects.toBeInstanceOf(HttpError);
    expect(calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- request`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `src/client/request.ts`**

```ts
export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
  }
}

export interface RequestOptions {
  baseUrl: string;
  token: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  fetchImpl?: typeof fetch;
  maxRateLimitRetries?: number;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function request<T>(opts: RequestOptions): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const url = buildUrl(opts.baseUrl, opts.path, opts.query);
  const maxRl = opts.maxRateLimitRetries ?? 3;
  let rlTries = 0;
  let srvTries = 0;

  while (true) {
    const res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 429 && rlTries < maxRl) {
      const after = Number(res.headers.get('Retry-After') ?? '1');
      await sleep(Math.max(0, after) * 1000);
      rlTries++;
      continue;
    }

    if (res.status >= 500 && srvTries < 1) {
      srvTries++;
      continue;
    }

    if (!res.ok) {
      throw new HttpError(res.status, await res.text());
    }

    return (await res.json()) as T;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- request`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/request.ts test/unit/request.test.ts
git commit -m "[FEAT] Add request helper with retry and error handling"
```

---

## Task 6: YouTrackClient core (get user, fetch issue, fetch issues)

**Files:**
- Create: `src/client/youtrackClient.ts`
- Test: no direct unit test (integration via mocked fetch in later tasks); ad-hoc verification.

- [ ] **Step 1: Implement `src/client/youtrackClient.ts`**

```ts
import { request } from './request';
import type {
  Issue, User, Comment, Attachment, WorkItem, SavedQuery,
  CustomField, CustomFieldValue, CustomFieldType,
  AgileBoard, Sprint, BoardView, BoardColumn,
} from './types';

const ISSUE_FIELDS = [
  'id', 'idReadable', 'summary', 'description',
  'created', 'updated',
  'project(id,shortName)',
  'reporter(id,login,fullName,avatarUrl)',
  'assignee:Assignee(id,login,fullName,avatarUrl)',
  'customFields(name,$type,value(id,name,login,fullName,text,presentation,minutes))',
].join(',');

function mapUser(u: any): User | null {
  if (!u) return null;
  return {
    id: u.id, login: u.login, fullName: u.fullName ?? u.login,
    avatarUrl: u.avatarUrl ?? '',
  };
}

function mapCustomFieldValue(raw: any, type: CustomFieldType): CustomFieldValue {
  if (raw === null || raw === undefined) return { kind: 'empty' };
  switch (type) {
    case 'enum':    return { kind: 'enum', id: raw.id, name: raw.name };
    case 'state':   return { kind: 'state', id: raw.id, name: raw.name };
    case 'user':    return { kind: 'user', login: raw.login, fullName: raw.fullName ?? raw.login };
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

function mapCustomField(raw: any): CustomField {
  const type = inferType(raw.$type ?? '');
  return { name: raw.name, type, value: mapCustomFieldValue(raw.value, type) };
}

function mapIssue(raw: any): Issue {
  return {
    id: raw.id,
    idReadable: raw.idReadable,
    summary: raw.summary,
    description: raw.description ?? '',
    project: { id: raw.project.id, shortName: raw.project.shortName },
    reporter: mapUser(raw.reporter),
    assignee: mapUser(raw.assignee),
    created: raw.created,
    updated: raw.updated,
    customFields: (raw.customFields ?? []).map(mapCustomField),
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
    return mapUser(raw)!;
  }

  async fetchIssue(idReadable: string): Promise<Issue> {
    const raw = await this.call<any>(`/api/issues/${idReadable}`, { query: { fields: ISSUE_FIELDS } });
    return mapIssue(raw);
  }

  async searchIssues(query: string, skip = 0, top = 50): Promise<Issue[]> {
    const raw = await this.call<any[]>('/api/issues', { query: { query, $skip: skip, $top: top, fields: ISSUE_FIELDS } });
    return raw.map(mapIssue);
  }

  async fetchSavedQueries(): Promise<SavedQuery[]> {
    const raw = await this.call<any[]>('/api/savedQueries', { query: { fields: 'id,name,query' } });
    return raw.map((r) => ({ id: r.id, name: r.name, query: r.query }));
  }

  async fetchComments(issueId: string): Promise<Comment[]> {
    const raw = await this.call<any[]>(`/api/issues/${issueId}/comments`, {
      query: { fields: 'id,text,created,author(id,login,fullName,avatarUrl)' },
    });
    return raw.map((r) => ({ id: r.id, text: r.text ?? '', author: mapUser(r.author)!, created: r.created }));
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
      author: mapUser(r.author)!,
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
      author: mapUser(raw.author)!,
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

  async assignIssue(issueId: string, login: string): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: { customFields: [{ name: 'Assignee', value: { login } }] },
    });
  }

  async transitionState(issueId: string, stateName: string): Promise<void> {
    await this.call(`/api/issues/${issueId}`, {
      method: 'POST',
      body: { customFields: [{ name: 'State', value: { name: stateName } }] },
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
        issuesByColumn[colId].push(mapIssue(rawIssue));
      }
    }

    return { columns, issuesByColumn };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/youtrackClient.ts
git commit -m "[FEAT] Add YouTrackClient with REST bindings"
```

---

## Task 7: BranchNameBuilder (TDD)

**Files:**
- Create: `src/domain/branchNameBuilder.ts`, `test/unit/branchNameBuilder.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/branchNameBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildBranchName, type BranchTemplateInput } from '../../src/domain/branchNameBuilder';

const base: BranchTemplateInput = {
  issue: {
    idReadable: 'FOO-123',
    summary: 'Add OAuth support + PKCE (v2)',
    type: 'Feature',
    state: 'In Progress',
    assigneeLogin: 'valentin',
    projectShortName: 'FOO',
    customFields: { Priority: 'Critical' },
  },
  template: '{assignee}/{id}-{summary}',
  summaryMaxLength: 40,
  separator: '-',
};

describe('buildBranchName', () => {
  it('fills the default template', () => {
    expect(buildBranchName(base)).toBe('valentin/FOO-123-add-oauth-support-pkce-v2');
  });

  it('truncates summary to max length', () => {
    const r = buildBranchName({ ...base, summaryMaxLength: 10 });
    expect(r.endsWith('add-oauth')).toBe(true);
  });

  it('handles empty assignee', () => {
    const r = buildBranchName({
      ...base,
      issue: { ...base.issue, assigneeLogin: '' },
    });
    expect(r).toBe('/FOO-123-add-oauth-support-pkce-v2');
  });

  it('resolves custom field placeholder', () => {
    const r = buildBranchName({
      ...base,
      template: '{id}-{field:Priority}',
    });
    expect(r).toBe('FOO-123-critical');
  });

  it('returns empty string for missing custom field', () => {
    const r = buildBranchName({
      ...base,
      template: '{id}-{field:DoesNotExist}',
    });
    expect(r).toBe('FOO-123-');
  });

  it('respects custom separator', () => {
    const r = buildBranchName({ ...base, separator: '_' });
    expect(r).toContain('add_oauth_support_pkce_v2');
  });

  it('sanitizes unicode', () => {
    const r = buildBranchName({
      ...base,
      issue: { ...base.issue, summary: 'Café déjà vu' },
    });
    expect(r).toMatch(/cafe-deja-vu/);
  });

  it('replaces unknown placeholders with empty', () => {
    const r = buildBranchName({ ...base, template: '{id}-{unknown}' });
    expect(r).toBe('FOO-123-');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- branchNameBuilder`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `src/domain/branchNameBuilder.ts`**

```ts
export interface BranchIssue {
  idReadable: string;
  summary: string;
  type: string;
  state: string;
  assigneeLogin: string;
  projectShortName: string;
  customFields: Record<string, string>;
}

export interface BranchTemplateInput {
  issue: BranchIssue;
  template: string;
  summaryMaxLength: number;
  separator: string;
}

function stripDiacritics(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function sanitize(raw: string, sep: string, maxLen?: number): string {
  if (!raw) return '';
  let s = stripDiacritics(raw).toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, sep);
  s = s.replace(new RegExp(`${escapeRe(sep)}+`, 'g'), sep);
  s = s.replace(new RegExp(`^${escapeRe(sep)}|${escapeRe(sep)}$`, 'g'), '');
  if (maxLen !== undefined && s.length > maxLen) {
    s = s.slice(0, maxLen);
    s = s.replace(new RegExp(`${escapeRe(sep)}+$`, 'g'), '');
  }
  return s;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildBranchName(input: BranchTemplateInput): string {
  const { issue, template, summaryMaxLength, separator } = input;

  const replacements: Record<string, string> = {
    id: issue.idReadable,
    summary: sanitize(issue.summary, separator, summaryMaxLength),
    type: sanitize(issue.type, separator),
    state: sanitize(issue.state, separator),
    assignee: issue.assigneeLogin,
    project: issue.projectShortName,
  };

  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    if (key.startsWith('field:')) {
      const fieldName = key.slice('field:'.length);
      return sanitize(issue.customFields[fieldName] ?? '', separator);
    }
    return replacements[key] ?? '';
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- branchNameBuilder`
Expected: all 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/branchNameBuilder.ts test/unit/branchNameBuilder.test.ts
git commit -m "[FEAT] Add BranchNameBuilder with placeholders"
```

---

## Task 8: TimeTracker duration parser (TDD)

**Files:**
- Create: `src/domain/timeTracker.ts`, `test/unit/timeTracker.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/timeTracker.test.ts
import { describe, it, expect } from 'vitest';
import { parseDuration } from '../../src/domain/timeTracker';

describe('parseDuration', () => {
  it.each([
    ['1h30m', 5400],
    ['90m', 5400],
    ['1.5h', 5400],
    ['2h', 7200],
    ['45m', 2700],
    ['5400', 5400],
    ['1h', 3600],
    ['0.25h', 900],
    ['30s', 30],
    ['1h30m15s', 5415],
  ])('parses %s to %d seconds', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'abc', '1h2x', '-5m'])('returns null for invalid %s', (bad) => {
    expect(parseDuration(bad)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- timeTracker`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domain/timeTracker.ts`**

```ts
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const re = /^(\d+(?:\.\d+)?)(h|m|s)/;
  let rest = trimmed;
  let total = 0;
  let matched = false;

  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) return null;
    matched = true;
    const value = Number(m[1]);
    const unit = m[2];
    if (value < 0) return null;
    total += unit === 'h' ? value * 3600 : unit === 'm' ? value * 60 : value;
    rest = rest.slice(m[0].length);
  }

  return matched ? Math.round(total) : null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- timeTracker`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/timeTracker.ts test/unit/timeTracker.test.ts
git commit -m "[FEAT] Add duration parser"
```

---

## Task 9: Cache schema and LRU (TDD)

**Files:**
- Create: `src/cache/schema.ts`, `src/cache/lru.ts`, `src/cache/cache.ts`, `test/unit/cache.test.ts`

- [ ] **Step 1: Write failing tests for cache behavior**

```ts
// test/unit/cache.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Cache } from '../../src/cache/cache';
import type { Issue } from '../../src/client/types';

function makeIssue(id: string): Issue {
  return {
    id, idReadable: id, summary: `Issue ${id}`, description: '',
    project: { id: 'p', shortName: 'P' },
    reporter: null, assignee: null,
    created: 0, updated: 0, customFields: [],
  };
}

describe('Cache', () => {
  let cache: Cache;
  let fetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const db = new Database(':memory:');
    fetcher = vi.fn(async (id: string) => makeIssue(id));
    cache = new Cache(db, { issuesTtlMs: 1000, maxIssues: 3, now: () => 0 });
  });

  it('fetches on miss and returns same on hit', async () => {
    const a = await cache.getIssue('A', fetcher);
    const b = await cache.getIssue('A', fetcher);
    expect(a.idReadable).toBe('A');
    expect(b.idReadable).toBe('A');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL expiry', async () => {
    let now = 0;
    cache = new Cache(new Database(':memory:'), { issuesTtlMs: 100, maxIssues: 10, now: () => now });
    await cache.getIssue('A', fetcher);
    now = 200;
    await cache.getIssue('A', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('evicts LRU beyond capacity', async () => {
    await cache.getIssue('A', fetcher);
    await cache.getIssue('B', fetcher);
    await cache.getIssue('C', fetcher);
    await cache.getIssue('D', fetcher); // evicts A
    await cache.getIssue('A', fetcher); // refetches A
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- cache`
Expected: FAIL.

- [ ] **Step 3: Implement `src/cache/schema.ts`**

```ts
import type { Database } from 'better-sqlite3';

export const SCHEMA_VERSION = 1;

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS field_schemas (
      project_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_queries (
      id INTEGER PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
  }
}
```

- [ ] **Step 4: Implement `src/cache/cache.ts`**

```ts
import type { Database } from 'better-sqlite3';
import { migrate } from './schema';
import type { Issue, SavedQuery } from '../client/types';

export interface CacheOptions {
  issuesTtlMs: number;
  maxIssues: number;
  fieldSchemasTtlMs?: number;
  savedQueriesTtlMs?: number;
  now?: () => number;
}

export class Cache {
  private now: () => number;

  constructor(private db: Database, private opts: CacheOptions) {
    this.now = opts.now ?? Date.now;
    migrate(db);
  }

  async getIssue(id: string, fetcher: (id: string) => Promise<Issue>): Promise<Issue> {
    const row = this.db.prepare('SELECT payload, fetched_at FROM issues WHERE id = ?').get(id) as
      { payload: string; fetched_at: number } | undefined;
    const now = this.now();
    if (row && now - row.fetched_at < this.opts.issuesTtlMs) {
      this.db.prepare('UPDATE issues SET accessed_at = ? WHERE id = ?').run(now, id);
      return JSON.parse(row.payload) as Issue;
    }
    const fresh = await fetcher(id);
    this.putIssue(fresh);
    return fresh;
  }

  putIssue(issue: Issue): void {
    const now = this.now();
    this.db.prepare(
      'INSERT OR REPLACE INTO issues (id, payload, fetched_at, accessed_at) VALUES (?, ?, ?, ?)'
    ).run(issue.idReadable, JSON.stringify(issue), now, now);
    this.evictLru();
  }

  invalidateIssue(id: string): void {
    this.db.prepare('DELETE FROM issues WHERE id = ?').run(id);
  }

  private evictLru(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM issues').get() as { c: number }).c;
    if (count <= this.opts.maxIssues) return;
    const overflow = count - this.opts.maxIssues;
    const rows = this.db.prepare('SELECT id FROM issues ORDER BY accessed_at ASC LIMIT ?').all(overflow) as { id: string }[];
    const del = this.db.prepare('DELETE FROM issues WHERE id = ?');
    for (const r of rows) del.run(r.id);
  }

  async getSavedQueries(fetcher: () => Promise<SavedQuery[]>): Promise<SavedQuery[]> {
    const ttl = this.opts.savedQueriesTtlMs ?? 5 * 60_000;
    const row = this.db.prepare('SELECT payload, fetched_at FROM saved_queries WHERE id = 1').get() as
      { payload: string; fetched_at: number } | undefined;
    const now = this.now();
    if (row && now - row.fetched_at < ttl) return JSON.parse(row.payload) as SavedQuery[];
    const fresh = await fetcher();
    this.db.prepare('INSERT OR REPLACE INTO saved_queries (id, payload, fetched_at) VALUES (1, ?, ?)')
      .run(JSON.stringify(fresh), now);
    return fresh;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- cache`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/cache/schema.ts src/cache/cache.ts test/unit/cache.test.ts
git commit -m "[FEAT] Add SQLite read-through cache with LRU"
```

---

## Task 10: AuthStore with first-run prompt

**Files:**
- Create: `src/auth/authStore.ts`

- [ ] **Step 1: Implement `src/auth/authStore.ts`**

```ts
import * as vscode from 'vscode';
import { YouTrackClient } from '../client/youtrackClient';

const TOKEN_KEY = 'youtrack.token';
const BASE_URL_KEY = 'youtrack.baseUrl';

export interface Credentials {
  baseUrl: string;
  token: string;
}

export class AuthStore {
  constructor(private context: vscode.ExtensionContext) {}

  async getCredentials(): Promise<Credentials | null> {
    const token = await this.context.secrets.get(TOKEN_KEY);
    const baseUrl = vscode.workspace.getConfiguration('youtrack').get<string>('baseUrl', '');
    if (!token || !baseUrl) return null;
    return { baseUrl, token };
  }

  async promptAndValidate(): Promise<Credentials | null> {
    const baseUrl = await vscode.window.showInputBox({
      prompt: 'YouTrack Cloud base URL',
      placeHolder: 'https://<workspace>.youtrack.cloud',
      validateInput: (v) => (v && /^https:\/\/.+/.test(v) ? null : 'Must be an https URL'),
    });
    if (!baseUrl) return null;

    const token = await vscode.window.showInputBox({
      prompt: 'YouTrack permanent token',
      password: true,
      validateInput: (v) => (v && v.length > 10 ? null : 'Token looks too short'),
    });
    if (!token) return null;

    try {
      const me = await new YouTrackClient(baseUrl, token).getMe();
      await this.context.secrets.store(TOKEN_KEY, token);
      await vscode.workspace.getConfiguration('youtrack').update(
        'baseUrl', baseUrl, vscode.ConfigurationTarget.Workspace,
      );
      vscode.window.showInformationMessage(`YouTrack: signed in as ${me.fullName}`);
      return { baseUrl, token };
    } catch (e) {
      vscode.window.showErrorMessage(`YouTrack: sign-in failed: ${(e as Error).message}`);
      return null;
    }
  }

  async signOut(): Promise<void> {
    await this.context.secrets.delete(TOKEN_KEY);
    await vscode.workspace.getConfiguration('youtrack').update(
      'baseUrl', undefined, vscode.ConfigurationTarget.Workspace,
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/auth/authStore.ts
git commit -m "[FEAT] Add AuthStore with first-run prompt"
```

---

## Task 11: Sidebar — IssueTreeProvider

**Files:**
- Create: `src/ui/issueTreeProvider.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Implement `src/ui/issueTreeProvider.ts`**

```ts
import * as vscode from 'vscode';
import type { Cache } from '../cache/cache';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Issue, SavedQuery } from '../client/types';

type Node =
  | { kind: 'query'; query: SavedQuery; loaded: Issue[]; skip: number; hasMore: boolean }
  | { kind: 'issue'; issue: Issue; parentQueryId: string }
  | { kind: 'loadMore'; parentQueryId: string };

const PAGE_SIZE = 50;

export class IssueTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<Node | undefined>();
  onDidChangeTreeData = this._emitter.event;

  private queries = new Map<string, Node & { kind: 'query' }>();

  constructor(private client: YouTrackClient, private cache: Cache) {}

  refresh(): void {
    this.queries.clear();
    this._emitter.fire(undefined);
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const queries = await this.cache.getSavedQueries(() => this.client.fetchSavedQueries());
      const nodes: (Node & { kind: 'query' })[] = queries.map((q) => ({
        kind: 'query', query: q, loaded: [], skip: 0, hasMore: true,
      }));
      this.queries.clear();
      for (const n of nodes) this.queries.set(n.query.id, n);
      return nodes;
    }

    if (element.kind === 'query') {
      if (element.loaded.length === 0) {
        const issues = await this.client.searchIssues(element.query.query, 0, PAGE_SIZE);
        element.loaded = issues;
        element.skip = issues.length;
        element.hasMore = issues.length === PAGE_SIZE;
        for (const i of issues) this.cache.putIssue(i);
      }
      const kids: Node[] = element.loaded.map((i) => ({ kind: 'issue', issue: i, parentQueryId: element.query.id }));
      if (element.hasMore) kids.push({ kind: 'loadMore', parentQueryId: element.query.id });
      return kids;
    }

    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'query') {
      const t = new vscode.TreeItem(node.query.name, vscode.TreeItemCollapsibleState.Collapsed);
      t.iconPath = new vscode.ThemeIcon('search');
      t.contextValue = 'query';
      return t;
    }
    if (node.kind === 'issue') {
      const t = new vscode.TreeItem(
        `${node.issue.idReadable}  ${node.issue.summary}`,
        vscode.TreeItemCollapsibleState.None,
      );
      t.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [node.issue.idReadable] };
      t.contextValue = 'issue';
      t.tooltip = node.issue.summary;
      return t;
    }
    const t = new vscode.TreeItem('Load more...', vscode.TreeItemCollapsibleState.None);
    t.command = { command: 'youtrack.loadMore', title: 'Load more', arguments: [node.parentQueryId] };
    return t;
  }

  async loadMore(parentQueryId: string): Promise<void> {
    const q = this.queries.get(parentQueryId);
    if (!q) return;
    const more = await this.client.searchIssues(q.query.query, q.skip, PAGE_SIZE);
    q.loaded = q.loaded.concat(more);
    q.skip += more.length;
    q.hasMore = more.length === PAGE_SIZE;
    for (const i of more) this.cache.putIssue(i);
    this._emitter.fire(q);
  }
}
```

- [ ] **Step 2: Add view contribution to `package.json`**

Replace the `"contributes"` block's `"views"` and `"viewsContainers"` with:

```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "youtrack",
      "title": "YouTrack",
      "icon": "$(checklist)"
    }
  ]
},
"views": {
  "youtrack": [
    {
      "id": "youtrack.issues",
      "name": "Issues"
    }
  ]
}
```

Add commands (replace empty `"commands"` array):

```json
"commands": [
  { "command": "youtrack.refresh", "title": "YouTrack: Refresh", "icon": "$(refresh)" },
  { "command": "youtrack.openIssue", "title": "YouTrack: Open Issue" },
  { "command": "youtrack.loadMore", "title": "YouTrack: Load More" }
],
"menus": {
  "view/title": [
    { "command": "youtrack.refresh", "when": "view == youtrack.issues", "group": "navigation" }
  ]
}
```

- [ ] **Step 3: Type-check and build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/ui/issueTreeProvider.ts package.json
git commit -m "[FEAT] Add sidebar IssueTreeProvider"
```

---

## Task 12: Wire extension activation

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Rewrite `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import Database from 'better-sqlite3';
import * as path from 'node:path';
import { YouTrackClient } from './client/youtrackClient';
import { Cache } from './cache/cache';
import { AuthStore } from './auth/authStore';
import { IssueTreeProvider } from './ui/issueTreeProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const auth = new AuthStore(context);
  let creds = await auth.getCredentials();
  if (!creds) creds = await auth.promptAndValidate();
  if (!creds) return;

  const client = new YouTrackClient(creds.baseUrl, creds.token);
  const dbPath = path.join(context.globalStorageUri.fsPath, 'cache.sqlite');
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  const db = new Database(dbPath);
  const cfg = vscode.workspace.getConfiguration('youtrack');
  const cache = new Cache(db, {
    issuesTtlMs: cfg.get<number>('cache.ttl.issues', 60) * 1000,
    maxIssues: 10_000,
    fieldSchemasTtlMs: cfg.get<number>('cache.ttl.fieldSchemas', 3600) * 1000,
    savedQueriesTtlMs: cfg.get<number>('cache.ttl.savedSearches', 300) * 1000,
  });

  const tree = new IssueTreeProvider(client, cache);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('youtrack.issues', tree),
    vscode.commands.registerCommand('youtrack.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('youtrack.loadMore', (id: string) => tree.loadMore(id)),
  );

  context.subscriptions.push({ dispose: () => db.close() });
}

export function deactivate(): void {
  // subscriptions handle cleanup
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "[FEAT] Wire activation: auth, cache, sidebar"
```

---

## Task 13: FieldRenderer (TDD)

**Files:**
- Create: `src/ui/fieldRenderer.ts`, `test/unit/fieldRenderer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/unit/fieldRenderer.test.ts
import { describe, it, expect } from 'vitest';
import { renderField } from '../../src/ui/fieldRenderer';
import type { CustomField } from '../../src/client/types';

describe('renderField', () => {
  it('renders enum', () => {
    const f: CustomField = { name: 'Priority', type: 'enum', value: { kind: 'enum', id: '1', name: 'High' } };
    expect(renderField(f)).toContain('High');
    expect(renderField(f)).toContain('data-field="Priority"');
  });

  it('renders empty state', () => {
    const f: CustomField = { name: 'Assignee', type: 'user', value: { kind: 'empty' } };
    expect(renderField(f)).toContain('—');
  });

  it('renders period as hours:minutes', () => {
    const f: CustomField = { name: 'Estimation', type: 'period', value: { kind: 'period', seconds: 5400 } };
    expect(renderField(f)).toContain('1h 30m');
  });

  it('renders unknown as readonly string', () => {
    const f: CustomField = { name: 'X', type: 'unknown', value: { kind: 'unknown', raw: '{"a":1}' } };
    expect(renderField(f)).toContain('readonly');
  });

  it('escapes HTML in values', () => {
    const f: CustomField = { name: 'X', type: 'string', value: { kind: 'string', text: '<img src=x>' } };
    const html = renderField(f);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `src/ui/fieldRenderer.ts`**

```ts
import type { CustomField, CustomFieldValue } from '../client/types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPeriod(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function valueToString(v: CustomFieldValue): string {
  switch (v.kind) {
    case 'empty':   return '—';
    case 'enum':    return v.name;
    case 'state':   return v.name;
    case 'user':    return v.fullName;
    case 'string':  return v.text;
    case 'date':    return new Date(v.iso).toLocaleDateString();
    case 'period':  return formatPeriod(v.seconds);
    case 'number':  return String(v.value);
    case 'bool':    return v.value ? 'Yes' : 'No';
    case 'version': return v.name;
    case 'unknown': return v.raw;
  }
}

export function renderField(f: CustomField): string {
  const display = escapeHtml(valueToString(f.value));
  const name = escapeHtml(f.name);
  const readonly = f.type === 'unknown' ? ' readonly' : '';
  return `<div class="field" data-field="${name}"${readonly}>
    <label>${name}</label>
    <span class="value">${display}</span>
  </div>`;
}
```

- [ ] **Step 4: Run tests**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/fieldRenderer.ts test/unit/fieldRenderer.test.ts
git commit -m "[FEAT] Add FieldRenderer"
```

---

## Task 14: IssueDetailPanel webview

**Files:**
- Create: `src/ui/issueDetailPanel.ts`, `media/issueDetail/index.html`, `media/issueDetail/style.css`, `media/issueDetail/main.js`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `media/issueDetail/style.css`**

```css
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1rem; }
.header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 0.5rem; margin-bottom: 1rem; }
.id { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
.summary { font-size: 1.2em; font-weight: 600; }
.field { display: flex; gap: 0.5rem; margin: 0.25rem 0; }
.field label { min-width: 140px; color: var(--vscode-descriptionForeground); }
.description { white-space: pre-wrap; margin: 1rem 0; }
.section { margin-top: 1.5rem; }
.section h3 { margin: 0 0 0.5rem 0; font-size: 1em; }
.comment, .work-item, .attachment { padding: 0.5rem 0; border-top: 1px dashed var(--vscode-panel-border); }
form.log-time { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; margin-top: 0.5rem; }
form.log-time button { grid-column: 2; justify-self: start; }
input, select, textarea, button {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 0.25rem;
}
button { cursor: pointer; }
```

- [ ] **Step 2: Create `media/issueDetail/main.js`**

```js
const vscode = acquireVsCodeApi();

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') {
    document.getElementById('root').innerHTML = msg.html;
    wireForms();
  }
});

function wireForms() {
  const form = document.querySelector('form.log-time');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    vscode.postMessage({
      type: 'logTime',
      duration: fd.get('duration'),
      date: fd.get('date'),
      typeId: fd.get('type'),
      text: fd.get('text'),
    });
  });
}

vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 3: Create `media/issueDetail/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="{{STYLE}}">
</head>
<body>
  <div id="root">Loading...</div>
  <script src="{{MAIN}}"></script>
</body>
</html>
```

- [ ] **Step 4: Implement `src/ui/issueDetailPanel.ts`**

```ts
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { Issue, Comment, Attachment, WorkItem } from '../client/types';
import { renderField } from './fieldRenderer';
import { parseDuration } from '../domain/timeTracker';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
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
    this.panel.webview.html = this.shellHtml();
    this.panel.onDidDispose(() => IssueDetailPanel.panels.delete(issueId));
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
  }

  static show(extensionUri: vscode.Uri, client: YouTrackClient, cache: Cache, issueId: string): void {
    const existing = IssueDetailPanel.panels.get(issueId);
    if (existing) { existing.panel.reveal(); return; }
    const p = new IssueDetailPanel(extensionUri, client, cache, issueId);
    IssueDetailPanel.panels.set(issueId, p);
    void p.reload();
  }

  private shellHtml(): string {
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'issueDetail');
    const tpl = fs.readFileSync(path.join(mediaUri.fsPath, 'index.html'), 'utf-8');
    return tpl
      .replace('{{STYLE}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'style.css')).toString())
      .replace('{{MAIN}}', this.panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'main.js')).toString());
  }

  private async reload(): Promise<void> {
    const [issue, comments, attachments, workItems, types] = await Promise.all([
      this.cache.getIssue(this.issueId, (id) => this.client.fetchIssue(id)),
      this.client.fetchComments(this.issueId),
      this.client.fetchAttachments(this.issueId),
      this.client.fetchWorkItems(this.issueId),
      this.workTypes.length ? Promise.resolve(this.workTypes) : this.client.listWorkItemTypes(),
    ]);
    this.workTypes = types;
    this.panel.webview.postMessage({ type: 'render', html: this.renderHtml(issue, comments, attachments, workItems) });
  }

  private renderHtml(issue: Issue, comments: Comment[], attachments: Attachment[], workItems: WorkItem[]): string {
    const fields = issue.customFields.map(renderField).join('');
    const commentHtml = comments.map((c) =>
      `<div class="comment"><b>${escapeHtml(c.author.fullName)}</b> — ${new Date(c.created).toLocaleString()}<br>${escapeHtml(c.text)}</div>`
    ).join('');
    const attachHtml = attachments.map((a) =>
      `<div class="attachment"><a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a> <span>${a.size} B</span></div>`
    ).join('');
    const workHtml = workItems.map((w) => {
      const h = Math.floor(w.duration / 3600);
      const m = Math.floor((w.duration % 3600) / 60);
      const dur = h ? `${h}h ${m}m` : `${m}m`;
      return `<div class="work-item"><b>${escapeHtml(w.author.fullName)}</b> — ${new Date(w.date).toLocaleDateString()} — ${dur} — ${escapeHtml(w.type?.name ?? '')}<br>${escapeHtml(w.text)}</div>`;
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
    if (msg.type === 'ready') return;
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
```

- [ ] **Step 5: Wire the `youtrack.openIssue` command in `src/extension.ts`**

After the `registerCommand('youtrack.loadMore', ...)` line, add:

```ts
vscode.commands.registerCommand('youtrack.openIssue', (id: string) =>
  IssueDetailPanel.show(context.extensionUri, client, cache, id),
),
```

And add the import at the top:

```ts
import { IssueDetailPanel } from './ui/issueDetailPanel';
```

- [ ] **Step 6: Include media in VSIX**

In `.vscodeignore`, add an exception at the end:

```
!media/**
```

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add src/ui/issueDetailPanel.ts media/issueDetail/ src/extension.ts .vscodeignore
git commit -m "[FEAT] Add IssueDetailPanel webview"
```

---

## Task 15: Command — Go to Issue

**Files:**
- Create: `src/commands/goToIssue.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `src/commands/goToIssue.ts`**

```ts
import * as vscode from 'vscode';

export async function goToIssue(): Promise<string | null> {
  const id = await vscode.window.showInputBox({
    prompt: 'Issue ID',
    placeHolder: 'FOO-123',
    validateInput: (v) => (/^[A-Z][A-Z0-9]+-\d+$/.test(v) ? null : 'Format: PROJECT-NUMBER'),
  });
  return id ?? null;
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

```ts
import { goToIssue } from './commands/goToIssue';

// inside activate, alongside the other registerCommand calls:
vscode.commands.registerCommand('youtrack.goToIssue', async () => {
  const id = await goToIssue();
  if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
}),
```

- [ ] **Step 3: Add command to `package.json`**

Append to the `"commands"` array:

```json
{ "command": "youtrack.goToIssue", "title": "YouTrack: Go to Issue..." }
```

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/commands/goToIssue.ts src/extension.ts package.json
git commit -m "[FEAT] Add Go to Issue command"
```

---

## Task 16: Command — Search

**Files:**
- Create: `src/commands/search.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `src/commands/search.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';

export async function search(client: YouTrackClient): Promise<string | null> {
  const query = await vscode.window.showInputBox({
    prompt: 'YouTrack query',
    placeHolder: 'project: FOO #Unresolved',
  });
  if (!query) return null;
  const issues = await client.searchIssues(query, 0, 50);
  if (!issues.length) {
    vscode.window.showInformationMessage('YouTrack: no matches');
    return null;
  }
  const picked = await vscode.window.showQuickPick(
    issues.map((i) => ({ label: i.idReadable, description: i.summary })),
    { placeHolder: 'Select an issue' },
  );
  return picked?.label ?? null;
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

```ts
import { search } from './commands/search';

// inside activate:
vscode.commands.registerCommand('youtrack.search', async () => {
  const id = await search(client);
  if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
}),
```

- [ ] **Step 3: Add to `package.json` commands**

```json
{ "command": "youtrack.search", "title": "YouTrack: Search..." }
```

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/commands/search.ts src/extension.ts package.json
git commit -m "[FEAT] Add Search command"
```

---

## Task 17: Command — Create Issue

**Files:**
- Create: `src/commands/createIssue.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Add project listing to `src/client/youtrackClient.ts`**

Append this method to the `YouTrackClient` class:

```ts
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
```

- [ ] **Step 2: Create `src/commands/createIssue.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';

export async function createIssue(client: YouTrackClient): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('youtrack');
  const defaultShort = cfg.get<string>('defaultProject', '');

  const projects = await client.listProjects();
  let projectId: string | undefined;
  if (defaultShort) {
    projectId = projects.find((p) => p.shortName === defaultShort)?.id;
  }
  if (!projectId) {
    const picked = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.shortName, description: p.name, id: p.id })),
      { placeHolder: 'Project' },
    );
    if (!picked) return null;
    projectId = picked.id;
  }

  const summary = await vscode.window.showInputBox({ prompt: 'Summary', validateInput: (v) => v ? null : 'Required' });
  if (!summary) return null;

  const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });

  const { idReadable } = await client.createIssue(projectId, summary, description ?? '');
  vscode.window.showInformationMessage(`YouTrack: created ${idReadable}`);
  return idReadable;
}
```

- [ ] **Step 3: Wire and add to `package.json`**

In `src/extension.ts`:

```ts
import { createIssue } from './commands/createIssue';

// inside activate:
vscode.commands.registerCommand('youtrack.createIssue', async () => {
  const id = await createIssue(client);
  if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
}),
```

In `package.json` commands:

```json
{ "command": "youtrack.createIssue", "title": "YouTrack: Create Issue..." }
```

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/client/youtrackClient.ts src/commands/createIssue.ts src/extension.ts package.json
git commit -m "[FEAT] Add Create Issue command"
```

---

## Task 18: Command — Assign to Me

**Files:**
- Create: `src/commands/assignToMe.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `src/commands/assignToMe.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

export async function assignToMe(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const me = await client.getMe();
  await client.assignIssue(issueId, me.login);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} assigned to you`);
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

```ts
import { assignToMe } from './commands/assignToMe';

// inside activate:
vscode.commands.registerCommand('youtrack.assignToMe', async (id?: string) => {
  const issueId = id ?? await vscode.commands.executeCommand<string>('youtrack.promptIssueId');
  if (!issueId) return;
  await assignToMe(client, cache, issueId);
}),
vscode.commands.registerCommand('youtrack.promptIssueId', async () => {
  return vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
}),
```

- [ ] **Step 3: Add to `package.json`**

```json
{ "command": "youtrack.assignToMe", "title": "YouTrack: Assign to Me" }
```

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/commands/assignToMe.ts src/extension.ts package.json
git commit -m "[FEAT] Add Assign to Me command"
```

---

## Task 19: Command — Change State

**Files:**
- Create: `src/commands/changeState.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `src/commands/changeState.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';

export async function changeState(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const issue = await client.fetchIssue(issueId);
  const states = await client.fetchProjectStateValues(issue.project.id);
  if (!states.length) {
    vscode.window.showErrorMessage('YouTrack: no states configured for this project');
    return;
  }
  const picked = await vscode.window.showQuickPick(states, { placeHolder: 'New state' });
  if (!picked) return;
  await client.transitionState(issueId, picked);
  cache.invalidateIssue(issueId);
  vscode.window.showInformationMessage(`YouTrack: ${issueId} -> ${picked}`);
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

```ts
import { changeState } from './commands/changeState';

vscode.commands.registerCommand('youtrack.changeState', async (id?: string) => {
  const issueId = id ?? await vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
  if (!issueId) return;
  await changeState(client, cache, issueId);
}),
```

- [ ] **Step 3: Add to `package.json`**

```json
{ "command": "youtrack.changeState", "title": "YouTrack: Change State..." }
```

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/commands/changeState.ts src/extension.ts package.json
git commit -m "[FEAT] Add Change State command"
```

---

## Task 20: Command — Log Time

**Files:**
- Create: `src/commands/logTime.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `src/commands/logTime.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { parseDuration } from '../domain/timeTracker';

export async function logTime(client: YouTrackClient, issueId: string): Promise<void> {
  const raw = await vscode.window.showInputBox({
    prompt: 'Duration',
    placeHolder: '1h30m',
    validateInput: (v) => (parseDuration(v) !== null ? null : 'Invalid duration'),
  });
  if (!raw) return;
  const seconds = parseDuration(raw)!;

  const dateStr = await vscode.window.showInputBox({
    prompt: 'Date (YYYY-MM-DD)',
    value: new Date().toISOString().slice(0, 10),
    validateInput: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'YYYY-MM-DD'),
  });
  if (!dateStr) return;

  const types = await client.listWorkItemTypes();
  const picked = types.length
    ? await vscode.window.showQuickPick([{ label: '(no type)', id: '' }, ...types.map((t) => ({ label: t.name, id: t.id }))], { placeHolder: 'Type' })
    : { id: '' };
  if (!picked) return;

  const text = await vscode.window.showInputBox({ prompt: 'Note (optional)' });

  await client.addWorkItem(issueId, {
    durationSeconds: seconds,
    date: new Date(dateStr).getTime(),
    typeId: (picked as any).id || undefined,
    text: text || undefined,
  });
  vscode.window.showInformationMessage(`YouTrack: logged ${raw} on ${issueId}`);
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

```ts
import { logTime } from './commands/logTime';

vscode.commands.registerCommand('youtrack.logTime', async (id?: string) => {
  const issueId = id ?? await vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
  if (!issueId) return;
  await logTime(client, issueId);
}),
```

- [ ] **Step 3: Add to `package.json`**

```json
{ "command": "youtrack.logTime", "title": "YouTrack: Log Time..." }
```

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/commands/logTime.ts src/extension.ts package.json
git commit -m "[FEAT] Add Log Time command"
```

---

## Task 21: Command — Create Branch

**Files:**
- Create: `src/commands/createBranch.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `src/commands/createBranch.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { buildBranchName } from '../domain/branchNameBuilder';
import type { Issue } from '../client/types';

function issueToTemplateInput(issue: Issue) {
  const fields: Record<string, string> = {};
  let type = '', state = '';
  for (const f of issue.customFields) {
    const v = f.value;
    let raw = '';
    if (v.kind === 'enum' || v.kind === 'state') raw = v.name;
    else if (v.kind === 'string') raw = v.text;
    else if (v.kind === 'user') raw = v.fullName;
    else if (v.kind === 'version') raw = v.name;
    else if (v.kind === 'number') raw = String(v.value);
    else if (v.kind === 'bool') raw = v.value ? 'yes' : 'no';
    fields[f.name] = raw;
    if (f.name === 'Type') type = raw;
    if (f.name === 'State') state = raw;
  }
  return {
    idReadable: issue.idReadable,
    summary: issue.summary,
    type, state,
    assigneeLogin: issue.assignee?.login ?? '',
    projectShortName: issue.project.shortName,
    customFields: fields,
  };
}

export async function createBranch(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('youtrack.branch');
  const template = cfg.get<string>('template', '{assignee}/{id}-{summary}');
  const maxLen = cfg.get<number>('summaryMaxLength', 40);
  const separator = cfg.get<string>('separator', '-');
  const copyOnly = cfg.get<boolean>('copyOnly', false);

  const issue = await cache.getIssue(issueId, (id) => client.fetchIssue(id));
  const name = buildBranchName({
    issue: issueToTemplateInput(issue),
    template, summaryMaxLength: maxLen, separator,
  });

  if (copyOnly) {
    await vscode.env.clipboard.writeText(name);
    vscode.window.showInformationMessage(`YouTrack: branch name copied: ${name}`);
    return;
  }

  const gitExt = vscode.extensions.getExtension<any>('vscode.git');
  if (!gitExt) {
    await vscode.env.clipboard.writeText(name);
    vscode.window.showWarningMessage(`Git extension unavailable. Branch name copied: ${name}`);
    return;
  }
  const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
  const api = git.getAPI(1);
  const repo = api.repositories[0];
  if (!repo) {
    vscode.window.showErrorMessage('YouTrack: no git repository in workspace');
    return;
  }
  await repo.createBranch(name, true);
  vscode.window.showInformationMessage(`YouTrack: checked out ${name}`);
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

```ts
import { createBranch } from './commands/createBranch';

vscode.commands.registerCommand('youtrack.createBranch', async (id?: string) => {
  const issueId = id ?? await vscode.window.showInputBox({ prompt: 'Issue ID', placeHolder: 'FOO-123' });
  if (!issueId) return;
  await createBranch(client, cache, issueId);
}),
```

- [ ] **Step 3: Add command and config to `package.json`**

Append to `"commands"`:

```json
{ "command": "youtrack.createBranch", "title": "YouTrack: Create Branch from Issue..." }
```

Append to `"configuration".properties`:

```json
"youtrack.baseUrl":                  { "type": "string", "default": "", "description": "YouTrack Cloud base URL." },
"youtrack.defaultProject":           { "type": "string", "default": "", "description": "Short name of project used by Create Issue when set." },
"youtrack.statusBarQuery":           { "type": "string", "default": "for: me and #Unresolved", "description": "Query for the status bar counter." },
"youtrack.cache.ttl.issues":         { "type": "number", "default": 60, "description": "Issue cache TTL (seconds)." },
"youtrack.cache.ttl.fieldSchemas":   { "type": "number", "default": 3600, "description": "Custom field schemas TTL (seconds)." },
"youtrack.cache.ttl.savedSearches":  { "type": "number", "default": 300, "description": "Saved searches TTL (seconds)." },
"youtrack.cache.pollInterval":       { "type": "number", "default": 60, "description": "Background refresh interval (seconds)." },
"youtrack.branch.template":          { "type": "string", "default": "{assignee}/{id}-{summary}", "description": "Branch name template." },
"youtrack.branch.summaryMaxLength":  { "type": "number", "default": 40, "description": "Summary token max length." },
"youtrack.branch.separator":         { "type": "string", "default": "-", "description": "Separator for sanitized tokens." },
"youtrack.branch.copyOnly":          { "type": "boolean", "default": false, "description": "Copy to clipboard instead of creating the branch." }
```

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/commands/createBranch.ts src/extension.ts package.json
git commit -m "[FEAT] Add Create Branch command and config"
```

---

## Task 22: Status bar

**Files:**
- Create: `src/ui/statusBar.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Create `src/ui/statusBar.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Issue } from '../client/types';

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private issues: Issue[] = [];

  constructor(private client: YouTrackClient, private intervalMs: number) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'youtrack.statusBarClick';
    this.item.show();
  }

  async refresh(): Promise<void> {
    const query = vscode.workspace.getConfiguration('youtrack').get<string>('statusBarQuery', 'for: me and #Unresolved');
    try {
      this.issues = await this.client.searchIssues(query, 0, 100);
      this.item.text = `$(check) ${this.issues.length}`;
      this.item.tooltip = `YouTrack: ${this.issues.length} issues matching "${query}"`;
    } catch (e) {
      this.item.text = '$(alert) YouTrack';
      this.item.tooltip = `YouTrack: ${(e as Error).message}`;
    }
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  async click(): Promise<void> {
    if (!this.issues.length) { await this.refresh(); }
    const picked = await vscode.window.showQuickPick(
      this.issues.map((i) => ({ label: i.idReadable, description: i.summary })),
      { placeHolder: 'Your issues' },
    );
    if (picked) vscode.commands.executeCommand('youtrack.openIssue', picked.label);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

Inside `activate`, after other commands:

```ts
import { StatusBar } from './ui/statusBar';

const pollMs = cfg.get<number>('cache.pollInterval', 60) * 1000;
const statusBar = new StatusBar(client, pollMs);
statusBar.start();
context.subscriptions.push(
  statusBar,
  vscode.commands.registerCommand('youtrack.statusBarClick', () => statusBar.click()),
);
```

- [ ] **Step 3: Build, commit**

```bash
npm run build
git add src/ui/statusBar.ts src/extension.ts
git commit -m "[FEAT] Add status bar counter"
```

---

## Task 23: Agile board webview

**Files:**
- Create: `src/ui/agileBoardPanel.ts`, `src/commands/openBoard.ts`, `media/agileBoard/index.html`, `media/agileBoard/style.css`, `media/agileBoard/main.js`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `media/agileBoard/style.css`**

```css
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 0.5rem; }
.toolbar { display: flex; gap: 0.5rem; padding: 0.25rem; border-bottom: 1px solid var(--vscode-panel-border); }
.board { display: flex; gap: 0.5rem; overflow-x: auto; padding-top: 0.5rem; }
.column { min-width: 240px; flex: 1; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 0.5rem; }
.column h4 { margin: 0 0 0.5rem 0; font-size: 0.9em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
.card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 0.5rem; margin-bottom: 0.5rem; cursor: grab; }
.card.dragging { opacity: 0.5; }
.card .id { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
.card .summary { margin-top: 0.25rem; }
.column.drop-target { outline: 2px dashed var(--vscode-focusBorder); }
```

- [ ] **Step 2: Create `media/agileBoard/main.js`**

```js
const vscode = acquireVsCodeApi();
let state = { columns: [], issuesByColumn: {} };

window.addEventListener('message', (evt) => {
  const msg = evt.data;
  if (msg.type === 'render') { state = msg.state; render(); }
  if (msg.type === 'rollback') {
    const { issueId, fromColumnId } = msg;
    for (const cid of Object.keys(state.issuesByColumn)) {
      const idx = state.issuesByColumn[cid].findIndex((i) => i.idReadable === issueId);
      if (idx !== -1) {
        const [issue] = state.issuesByColumn[cid].splice(idx, 1);
        state.issuesByColumn[fromColumnId].push(issue);
        break;
      }
    }
    render();
  }
});

function render() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (const col of state.columns) {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.columnId = col.id;
    colEl.innerHTML = `<h4>${escape(col.name)}</h4>`;

    for (const issue of state.issuesByColumn[col.id] ?? []) {
      const card = document.createElement('div');
      card.className = 'card';
      card.draggable = true;
      card.dataset.issueId = issue.idReadable;
      card.dataset.fromColumn = col.id;
      card.innerHTML = `<div class="id">${escape(issue.idReadable)}</div><div class="summary">${escape(issue.summary)}</div>`;
      card.addEventListener('dragstart', (e) => { card.classList.add('dragging'); e.dataTransfer.setData('text/plain', issue.idReadable + '|' + col.id); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => vscode.postMessage({ type: 'openIssue', issueId: issue.idReadable }));
      colEl.appendChild(card);
    }

    colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('drop-target'); });
    colEl.addEventListener('dragleave', () => colEl.classList.remove('drop-target'));
    colEl.addEventListener('drop', (e) => {
      e.preventDefault();
      colEl.classList.remove('drop-target');
      const [issueId, fromColumnId] = (e.dataTransfer.getData('text/plain') || '').split('|');
      if (!issueId || fromColumnId === col.id) return;
      const fromList = state.issuesByColumn[fromColumnId];
      const idx = fromList.findIndex((i) => i.idReadable === issueId);
      if (idx === -1) return;
      const [issue] = fromList.splice(idx, 1);
      (state.issuesByColumn[col.id] ??= []).push(issue);
      render();
      vscode.postMessage({ type: 'moveCard', issueId, fromColumnId, toColumnId: col.id });
    });

    board.appendChild(colEl);
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 3: Create `media/agileBoard/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="{{STYLE}}">
</head>
<body>
  <div class="toolbar"><b>Agile Board</b></div>
  <div id="board" class="board"></div>
  <script src="{{MAIN}}"></script>
</body>
</html>
```

- [ ] **Step 4: Implement `src/ui/agileBoardPanel.ts`**

```ts
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
    if (msg.type === 'ready') return;
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
```

- [ ] **Step 5: Create `src/commands/openBoard.ts`**

```ts
import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { AgileBoardPanel } from '../ui/agileBoardPanel';

export async function openBoard(extensionUri: vscode.Uri, client: YouTrackClient): Promise<void> {
  const boards = await client.fetchAgileBoards();
  if (!boards.length) { vscode.window.showInformationMessage('YouTrack: no agile boards'); return; }

  const boardPick = boards.length === 1 ? { id: boards[0].id, label: boards[0].name } :
    await vscode.window.showQuickPick(boards.map((b) => ({ id: b.id, label: b.name })), { placeHolder: 'Board' });
  if (!boardPick) return;

  const sprints = await client.fetchSprints(boardPick.id);
  const current = sprints.find((s) => s.current) ?? sprints[0];
  if (!current) { vscode.window.showInformationMessage('YouTrack: no sprints'); return; }

  const sprintPick = sprints.length === 1 ? current :
    (await vscode.window.showQuickPick(
      sprints.map((s) => ({ id: s.id, label: s.name, description: s.current ? '(current)' : '' })),
      { placeHolder: `Sprint (default: ${current.name})` },
    )) ?? current;

  AgileBoardPanel.show(extensionUri, client, boardPick.id, (sprintPick as { id: string }).id);
}
```

- [ ] **Step 6: Wire in `src/extension.ts`**

```ts
import { openBoard } from './commands/openBoard';

vscode.commands.registerCommand('youtrack.openBoard', () => openBoard(context.extensionUri, client)),
```

- [ ] **Step 7: Add command to `package.json`**

```json
{ "command": "youtrack.openBoard", "title": "YouTrack: Open Agile Board..." }
```

- [ ] **Step 8: Build, commit**

```bash
npm run build
git add src/ui/agileBoardPanel.ts src/commands/openBoard.ts media/agileBoard/ src/extension.ts package.json
git commit -m "[FEAT] Add agile board webview"
```

---

## Task 24: URI handler

**Files:**
- Create: `src/ui/uriHandler.ts`
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Create `src/ui/uriHandler.ts`**

```ts
import * as vscode from 'vscode';

export class UriHandler implements vscode.UriHandler {
  handleUri(uri: vscode.Uri): void {
    if (uri.authority === 'issue' || uri.path.startsWith('/')) {
      const id = uri.path.replace(/^\/+/, '') || uri.authority;
      if (id) vscode.commands.executeCommand('youtrack.openIssue', id);
    }
  }
}
```

- [ ] **Step 2: Wire in `src/extension.ts`**

```ts
import { UriHandler } from './ui/uriHandler';

context.subscriptions.push(vscode.window.registerUriHandler(new UriHandler()));
```

- [ ] **Step 3: Declare scheme in `package.json`** (no changes needed — URI handler is contributed via `registerUriHandler`; VS Code uses `vscode://<publisher>.<name>/` scheme automatically).

- [ ] **Step 4: Build, commit**

```bash
npm run build
git add src/ui/uriHandler.ts src/extension.ts
git commit -m "[FEAT] Add URI handler for deep links"
```

---

## Task 25: Sign Out command

**Files:**
- Modify: `src/extension.ts`, `package.json`

- [ ] **Step 1: Add command in `src/extension.ts`**

```ts
vscode.commands.registerCommand('youtrack.signOut', async () => {
  await auth.signOut();
  vscode.window.showInformationMessage('YouTrack: signed out. Reload window to re-authenticate.');
}),
```

- [ ] **Step 2: Add to `package.json`**

```json
{ "command": "youtrack.signOut", "title": "YouTrack: Sign Out" }
```

- [ ] **Step 3: Build, commit**

```bash
npm run build
git add src/extension.ts package.json
git commit -m "[FEAT] Add Sign Out command"
```

---

## Task 26: Activation integration test

**Files:**
- Create: `test/integration/activation.test.ts`, `test/runTest.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `test/runTest.ts`**

```ts
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'integration', 'index');
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Create `test/integration/index.ts`**

```ts
import * as path from 'node:path';
import { glob } from 'glob';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true });
  const files = await glob('**/*.test.js', { cwd: __dirname });
  files.forEach((f) => mocha.addFile(path.resolve(__dirname, f)));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} failures`)) : resolve()));
  });
}
```

- [ ] **Step 3: Create `test/integration/activation.test.ts`**

```ts
import * as vscode from 'vscode';
import * as assert from 'node:assert';

suite('activation', () => {
  test('extension activates', async () => {
    const ext = vscode.extensions.getExtension('lotchi-studio.ls-youtrack-vscode');
    assert.ok(ext, 'extension present');
    // Activation will prompt for credentials; skip if not provided in CI.
  });
});
```

- [ ] **Step 4: Add test deps and script**

```bash
npm install --save-dev glob mocha @types/mocha
```

In `package.json` `"scripts"`:

```json
"test:integration": "tsc -p tsconfig.test.json && node ./test-dist/runTest.js"
```

Create `tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "test-dist",
    "rootDir": ".",
    "types": ["node", "mocha"]
  },
  "include": ["test/**/*.ts", "src/**/*.ts"]
}
```

- [ ] **Step 5: Commit**

```bash
git add test/ tsconfig.test.json package.json package-lock.json
git commit -m "[TEST] Add integration test harness"
```

---

## Task 27: QA checklist and README

**Files:**
- Create: `docs/QA.md`
- Modify: `README.md`

- [ ] **Step 1: Create `docs/QA.md`**

```markdown
# Manual QA Checklist

Run before each release.

## Setup
- [ ] Fresh VS Code workspace with git repo
- [ ] YouTrack Cloud URL and permanent token available
- [ ] VSIX installed

## First run
- [ ] Extension prompts for base URL and token
- [ ] Invalid URL rejected with helpful message
- [ ] Invalid token rejected with helpful message
- [ ] Successful sign-in shows "signed in as <name>"

## Sidebar
- [ ] YouTrack activity bar icon appears
- [ ] Saved searches render at top level
- [ ] Expanding a saved search loads issues
- [ ] "Load more" appears when >50 results
- [ ] Refresh button re-fetches

## Issue detail
- [ ] Clicking an issue opens the detail panel
- [ ] Description renders
- [ ] Custom fields render
- [ ] Comments render (newest first)
- [ ] Attachments list renders with working links
- [ ] Time logged section renders

## Time tracking
- [ ] Log Time command parses "1h30m"
- [ ] Log Time command rejects "abc"
- [ ] Logged time appears in detail panel after save
- [ ] Log Time form inside detail panel works

## Commands
- [ ] Go to Issue opens the right panel
- [ ] Search returns matching issues
- [ ] Create Issue round-trips (appears in sidebar after refresh)
- [ ] Assign to Me transfers assignment
- [ ] Change State transitions visibly
- [ ] Sign Out clears credentials

## Branch from issue
- [ ] Default template produces valid branch name
- [ ] Custom template respected
- [ ] copyOnly mode copies without creating branch
- [ ] Unicode summaries sanitized
- [ ] Missing custom field becomes empty

## Agile board
- [ ] Board picker appears when multiple boards exist
- [ ] Current sprint selected by default
- [ ] Cards render in correct columns
- [ ] Drag-and-drop transitions state
- [ ] Failed move rolls back
- [ ] Clicking a card opens detail panel

## Status bar
- [ ] Counter appears and updates
- [ ] Click opens QuickPick of assigned issues

## URI handler
- [ ] `vscode://lotchi-studio.ls-youtrack-vscode/FOO-123` opens the issue
```

- [ ] **Step 2: Update `README.md`**

```markdown
# ls-youtrack-vscode

VS Code extension for YouTrack Cloud.

## Features
- Sidebar with saved searches and issues
- Issue detail webview with native time tracking
- Agile board with drag-and-drop
- Branch from issue with configurable template
- Command palette for create, search, go-to-ID, assign, transition, log time

## Install
Download the latest `.vsix` from Releases, then:

    code --install-extension ls-youtrack-vscode-<version>.vsix

## Configure
On first run you are prompted for your YouTrack Cloud base URL and a permanent token (Profile -> Account Security -> New token).

See settings under "YouTrack" for branch template and cache tuning.

## Develop
    npm install
    npm run build
    npm test
    npm run package
```

- [ ] **Step 3: Commit**

```bash
git add docs/QA.md README.md
git commit -m "[DOC] Add QA checklist and README"
```

---

## Task 28: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: [ 'v*' ]

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run package
      - uses: softprops/action-gh-release@v2
        with:
          files: '*.vsix'
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "[BUILD] Add release workflow"
```

---

## Task 29: Final self-check and verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 2: All unit tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Package check**

Run: `npm run package`
Expected: produces `.vsix`.

- [ ] **Step 4: Manual smoke test**

Install the produced VSIX in a clean VS Code instance:

```bash
code --install-extension ls-youtrack-vscode-0.1.0.vsix
```

Walk through `docs/QA.md`.

- [ ] **Step 5: Tag v0.1.0**

```bash
git tag v0.1.0
git push --tags
```

---

## Notes

- Activation is `onStartupFinished` which keeps VS Code startup fast; first API call happens only when the user opens the sidebar.
- `better-sqlite3` is native — the extension host bundles it via `external: ['better-sqlite3']` in esbuild and the `.vscodeignore` exception ensures the prebuilt binary ships inside the VSIX. If publishing to multiple platforms, a separate build matrix is required; out of scope for v1 (Windows only internally).
- The VS Code Git API (`vscode.git`) is used to create the branch; the fallback copies to clipboard if it's unavailable.
- Field editing from the detail panel is read-only in v1 for anything except work items. Writing back custom field edits is deliberately deferred — the underlying `updateIssueField()` exists in the client but is only wired through for assignee and state changes via dedicated commands. Add inline editing in v1.1 if users request it.
