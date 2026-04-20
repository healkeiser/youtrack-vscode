# ls-youtrack-vscode — VS Code Extension Design

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Target:** VS Code 1.85+, YouTrack Cloud

## 1. Purpose

A VS Code extension that surfaces YouTrack Cloud issues, time tracking, and agile boards inside the editor. Built because the existing YouTrack VS Code extensions are poor, and the team (10 people) uses YouTrack as their tracker of record. Replicates the parts of the Linear experience the team misses — keyboard-driven navigation, fast issue access, branch-from-issue — while keeping YouTrack's native time tracking as a first-class feature.

## 2. Scope

### In scope (v1)

- Authenticated REST client for YouTrack Cloud
- Local SQLite cache with read-through semantics and background polling
- Sidebar TreeView: saved searches, then issues beneath each
- Issue detail webview: description, custom fields, comments, attachments list, work items
- Command palette actions for create, search, go-to-ID, assign-to-me, change state, log time, create branch, open agile board
- Status bar item showing issues assigned to current user
- `ytrack://ISSUE-123` URI handler opening the detail webview
- Time tracking: add work items via quick-log command or inline form on the detail panel
- Branch creation from issue with a configurable template + placeholder system
- Agile board: webview kanban with drag-and-drop state transitions

### Out of scope (v1)

- YouTrack self-hosted deployments (only Cloud supported)
- Workflow editing
- Knowledge base browsing
- Swimlanes and WIP limits on agile boards
- Inline card editing on the agile board (click opens detail panel instead)
- Attachment upload
- Issue linking UI
- Query builder GUI (users write YouTrack query language directly in the search prompt)
- Offline write queue (offline read works via cache; writes require connectivity)
- Marketplace publishing (distributed as VSIX internally)

## 3. Architecture

### 3.1 Units

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `YouTrackClient` | REST wrapper around YouTrack Cloud API. Returns typed domain objects. No VS Code imports. | `node-fetch` |
| `Cache` | SQLite layer via `better-sqlite3`. Schema migrations. Read-through wrapper over `YouTrackClient`. | `better-sqlite3` |
| `AuthStore` | First-run flow, token storage via `SecretStorage`, base URL validation. | `vscode` |
| `IssueTreeProvider` | `TreeDataProvider<IssueNode>` for the sidebar. | `Cache` |
| `IssueDetailPanel` | Webview lifecycle, HTML template, `postMessage` bridge. Renders description, fields, comments, attachments, work items. | `Cache`, `FieldRenderer`, `TimeTracker` |
| `FieldRenderer` | Introspects YouTrack custom field schemas, renders generic editors (enum, user, period, string, date). Pure TS returning HTML fragments. | none |
| `TimeTracker` | Duration-string parser (`1h30m` to seconds). Work-item CRUD. | `YouTrackClient` |
| `BranchNameBuilder` | Pure function: issue + template string to sanitized branch name. Unit-testable in isolation. | none |
| `AgileBoardPanel` | Webview host for kanban. Owns board HTML/CSS/JS. `postMessage` bridge for drag events. | `Cache`, `YouTrackClient` |
| `CommandRegistry` | Wires command IDs to handlers. Single entry point for extension activation. | all others |

### 3.2 Data flow

```
User action
  v
CommandRegistry -> handler
  v
Cache.getX() ---> hit: return cached -> UI
               |
               +-> miss or stale: YouTrackClient.fetchX() -> write Cache -> UI

User write (state change, log time, etc.)
  v
YouTrackClient.postX() -> on success: update Cache -> notify UI providers
                       -> on error: surface error, UI rolls back optimistic update
```

### 3.3 Cache policy

- **Read-through**: every read asks the cache first. If the row is missing or older than TTL, fetch from API and update.
- **TTL defaults**: issues 60s, custom-field schemas 1h, saved searches 5m. All configurable.
- **Background poll**: every 60s (configurable), refresh the currently visible sidebar issues and the open agile board's sprint.
- **Writes are write-through**: the API call happens first; cache is updated only on success. No offline write queue in v1.
- **Eviction**: LRU, capped at 10k issues per user. Schema migrations handled via a `schema_version` table.

## 4. Features

### 4.1 Authentication

- First activation: prompt for base URL (`https://<workspace>.youtrack.cloud`) and permanent token.
- Base URL validated by hitting `/api/users/me`.
- Token stored in `vscode.SecretStorage`. Base URL stored in workspace settings unless explicitly set globally.
- Command `YouTrack: Sign Out` clears both.

### 4.2 Sidebar (TreeView)

- Top level: user's saved searches, fetched from `/api/savedQueries`.
- Second level: issues matching each saved search, paginated (50 per page, "Load more" node).
- Each issue node: ID, summary, state icon, assignee avatar (via YouTrack avatar URL).
- Refresh button re-fetches from API ignoring cache TTL.

### 4.3 Issue detail (webview)

- Opened via tree click, command, or `ytrack://` URI.
- Sections: header (ID, summary, state), description (markdown), custom fields (via `FieldRenderer`), comments (newest first), attachments (list + open-in-browser), work items (list + add form).
- Edits are inline; save triggers `YouTrackClient.updateIssue()`.

### 4.4 Command palette actions

| Command ID | Behavior |
| --- | --- |
| `youtrack.createIssue` | QuickPick for project, then input for summary, optional description in untitled editor. |
| `youtrack.search` | Input box accepting YouTrack query language. Results shown in QuickPick. |
| `youtrack.goToIssue` | Input box for ID; opens detail. |
| `youtrack.assignToMe` | Acts on currently focused issue (tree selection or open detail). |
| `youtrack.changeState` | QuickPick of valid transitions for the focused issue. |
| `youtrack.logTime` | Prompts duration, date, work type, description. Acts on focused issue. |
| `youtrack.createBranch` | See section 4.7. |
| `youtrack.openBoard` | QuickPick of agile boards if multiple, opens panel. |
| `youtrack.signOut` | Clears auth. |

### 4.5 Status bar

- Left-aligned item showing `$(check) N` where N is the count of issues assigned to the current user matching the configured query (`youtrack.statusBarQuery`, default `for: me and #Unresolved`).
- Click: opens a QuickPick of those issues.
- Updates on each background poll.

### 4.6 Time tracking

- Command `youtrack.logTime` and an "Add work item" form inside the detail panel call the same code path.
- Duration input: parsed by `TimeTracker.parseDuration()`. Accepts `1h30m`, `90m`, `1.5h`, `5400` (seconds). Fails closed if unparseable.
- Work type: dropdown populated from `/api/admin/timeTrackingSettings/workItemTypes`.
- Date: default today, date picker (webview) or `YYYY-MM-DD` text input (command).
- Description: optional free text.
- POSTs to `/api/issues/{id}/timeTracking/workItems`.
- Work items listed in detail panel under a "Time logged" section, grouped by date, with total.

### 4.7 Branch from issue

- Command `youtrack.createBranch` acts on the focused issue.
- Builds name via `BranchNameBuilder.build(issue, template)`.
- Creates branch using `vscode.git` extension API (`git.createBranch` with checkout).
- If the workspace has no git repo, surface an error.
- Optional: copy branch name to clipboard if `youtrack.branch.copyOnly` is `true`.

**Template placeholders**

| Placeholder | Value |
| --- | --- |
| `{id}` | Issue ID, e.g. `FOO-123` |
| `{summary}` | Summary, sanitized: lowercase, non-alphanumeric to separator, collapsed, truncated to `summaryMaxLength` |
| `{type}` | Issue type name |
| `{state}` | Current state name, sanitized |
| `{assignee}` | Assignee login (empty string if unassigned) |
| `{project}` | Project short name |
| `{field:<name>}` | Any custom field by display name |

**Config keys**

- `youtrack.branch.template` — default `{assignee}/{id}-{summary}`
- `youtrack.branch.summaryMaxLength` — default `40`
- `youtrack.branch.separator` — default `-`
- `youtrack.branch.copyOnly` — default `false`

### 4.8 Agile board

- Command `youtrack.openBoard` opens the agile board webview.
- Board source: `/api/agiles/{boardId}/sprints/{sprintId}/board`.
- Layout: horizontal columns = board states. Scroll horizontally if more columns than fit.
- Cards show: ID, summary (truncated), assignee avatar, estimation, priority dot.
- Drag-and-drop: HTML5 drag API; on drop, the webview posts `{ type: 'moveCard', issueId, toState }` to the extension. Extension calls state transition API. Card is moved optimistically; on error, card snaps back and an error toast is shown.
- Clicking a card opens the issue detail panel (does not edit in place).
- Board picker dropdown at the top if the user has access to multiple boards.
- Sprint picker defaults to the current sprint.

## 5. Configuration

All settings live under the `youtrack.*` namespace.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `youtrack.baseUrl` | string | `""` | Cloud workspace base URL. |
| `youtrack.defaultProject` | string | `""` | Project used when creating new issues without prompting. |
| `youtrack.statusBarQuery` | string | `"for: me and #Unresolved"` | Query for the status bar counter. |
| `youtrack.cache.ttl.issues` | number (s) | `60` | Issue cache TTL. |
| `youtrack.cache.ttl.fieldSchemas` | number (s) | `3600` | Custom field schema TTL. |
| `youtrack.cache.ttl.savedSearches` | number (s) | `300` | Saved searches TTL. |
| `youtrack.cache.pollInterval` | number (s) | `60` | Background refresh interval. |
| `youtrack.branch.template` | string | `{assignee}/{id}-{summary}` | Branch name template. |
| `youtrack.branch.summaryMaxLength` | number | `40` | Summary truncation length. |
| `youtrack.branch.separator` | string | `-` | Separator for sanitized tokens. |
| `youtrack.branch.copyOnly` | boolean | `false` | If true, copy to clipboard instead of creating the branch. |

## 6. Error handling

- All API calls go through a single `request()` helper that:
  - Attaches the bearer token.
  - Retries on 429 with `Retry-After` header (max 3 retries).
  - Surfaces 4xx (except 429) as user-visible errors via `vscode.window.showErrorMessage`.
  - Treats 5xx as transient: log, retry once, then fail.
- Cache failures (SQLite write errors, disk full) are logged and degrade to API-only mode without blocking the user.
- The webview bridge messages (`moveCard`, `saveField`, etc.) always include a `correlationId`; the extension echoes it back in the response so the webview can reconcile optimistic state.

## 7. Testing

### Unit tests (`vitest`)

- `BranchNameBuilder`: every placeholder, Unicode handling, truncation, empty fields, custom field names with spaces.
- `TimeTracker.parseDuration`: valid formats, edge cases, invalid input.
- `Cache`: TTL expiry, LRU eviction, schema migration, read-through hit/miss.
- `FieldRenderer`: every field type, empty values, read-only rendering.

### Integration tests (`@vscode/test-electron`)

- Full extension activation with a mocked `YouTrackClient`.
- Command palette round-trips for each action.
- Webview bootstrap and `postMessage` round-trip.

### Manual QA checklist

- Ship a `docs/QA.md` with a 15-item smoke checklist covering each feature above.

## 8. Build and distribution

- Language: TypeScript.
- Bundler: `esbuild` (entry `src/extension.ts` -> `dist/extension.js`).
- Packaging: `@vscode/vsce package` produces a `.vsix`.
- Distribution: internal share (no Marketplace). Team installs via `code --install-extension <vsix>`.
- CI: GitHub Actions builds the VSIX on tag push and attaches it as a release asset. Mirrors the `lotchi-studio/.ls-rez-master` workflow pattern where possible, but this is not a Rez package so versioning is standard SemVer via `package.json`.

## 9. Project layout

```
ls-youtrack-vscode/
  src/
    extension.ts              # activate/deactivate
    client/youtrackClient.ts
    cache/cache.ts
    cache/schema.ts
    auth/authStore.ts
    ui/issueTreeProvider.ts
    ui/issueDetailPanel.ts
    ui/agileBoardPanel.ts
    ui/fieldRenderer.ts
    domain/branchNameBuilder.ts
    domain/timeTracker.ts
    commands/registry.ts
    commands/*.ts             # one file per command
  media/
    issueDetail/              # webview assets
    agileBoard/
  test/
    unit/
    integration/
  docs/
    QA.md
    superpowers/specs/
  package.json
  tsconfig.json
  esbuild.config.mjs
```

## 10. Risks and open questions

- **YouTrack custom field polymorphism**: each project can define arbitrary fields. `FieldRenderer` must handle the known primitive types (enum, user, period, string, date, int, float, bool, version, state-machine) and render unknown types as read-only strings. If a customer hits an unsupported type, the issue detail still loads.
- **Agile board drag performance**: large sprints (100+ issues) may stutter. Mitigation: render via plain DOM, no heavy frontend framework; virtualize columns if tests show lag.
- **YouTrack rate limits**: Cloud enforces rate limits that vary by plan. The 429 handler plus 60s poll should keep usage well under typical limits for a 10-person team, but worth monitoring via a debug log.
- **Git API availability**: `vscode.git` is a built-in extension but its API is not fully stable. Fallback path: shell out to `git checkout -b <name>` in the integrated terminal if the API is unavailable.
- **`ytrack://` URI scheme**: VS Code's URI handler only fires if the editor is already running. Cold-start deep linking needs OS-level protocol registration, which is out of scope for v1.
