# YouTrack for VS Code

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/valentinbeaumont.youtrack-vscode?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=valentinbeaumont.youtrack-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/valentinbeaumont.youtrack-vscode)](https://marketplace.visualstudio.com/items?itemName=valentinbeaumont.youtrack-vscode)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/valentinbeaumont.youtrack-vscode)](https://marketplace.visualstudio.com/items?itemName=valentinbeaumont.youtrack-vscode&ssr=false#review-details)
[![License](https://img.shields.io/github/license/healkeiser/youtrack-vscode)](./LICENSE)

A third-party YouTrack Cloud client for Visual Studio Code. Sidebar, full-fidelity issue detail, agile board, time tracking, and a pile of editor-native workflows that turn the extension into a **"create a ticket and keep coding"** loop rather than a **"read tickets while coding"** loop.

Built by [Valentin Beaumont](https://github.com/healkeiser). Not affiliated with JetBrains.

## Quick start

1. Install from the Marketplace or run `ext install valentinbeaumont.youtrack-vscode`.
2. `Ctrl+Shift+P` → **YouTrack: Sign In**.
3. Enter your YouTrack Cloud base URL (e.g. `https://<org>.youtrack.cloud/`).
4. Paste a permanent token. Generate one in YouTrack: **avatar → Profile → Account Security → New token**, scope it to **YouTrack** (not read-only).
5. Open the YouTrack activity-bar icon on the left and pick a view.

## Screenshots

> _Screenshots live under `docs/screenshots/`. Drop updated captures there and they will render below._

| Sidebar | Issue detail | Agile board |
| --- | --- | --- |
| ![Sidebar](docs/screenshots/sidebar.png) | ![Issue detail](docs/screenshots/issue-detail.png) | ![Agile board](docs/screenshots/agile-board.png) |

## Features

### Sidebar
- Five views in a dedicated activity-bar container: **Notifications**, **Assigned to me**, **Recently opened**, **Issues**, **Agile Boards**.
- Per-view filter state: text filter, state filter, tag filter, `#Unresolved` toggle (on by default for _Assigned to me_), sort mode, group-by-project. Filters on _Assigned to me_ don't bleed into the _Issues_ umbrella and vice-versa.
- _Issues_ view rolls up **Reported by me**, **Commented by me**, **All issues**, **All tickets** under a single section.
- Right-click any issue → change state, assign to me, log time, create branch, copy ID/link, open in browser.

### Issue detail panel
- Two-column layout with a sticky side panel. Every side-panel row — State, Priority, Assignee, and every project custom field (enum, state, user, version, bool, date, period, string, int, float) — is a clickable pill that opens a type-aware editor.
- **Subtasks section** with a live progress bar (`done / total`) and clickable child-issue rows that deep-link into their own panels.
- Editable summary and description with Markdown **Write**/**Preview** tabs, a full formatting toolbar (bold, italic, strikethrough, code, code block, link, quote, bullet/numbered lists, mention), and double-click-to-edit.
- **Comment drafts** auto-persist per issue in `globalState` — close the panel, reload the window, or accidentally `Ctrl+W` the tab; your draft is still there when you return.
- **@mention autocomplete** with a VS Code-styled dropdown against the workspace user roster (arrow keys, Enter/Tab to accept, Esc to dismiss, click to pick).
- **Reactions** on comments — click the smiley next to Edit to add/remove emoji reactions; existing reactions render as pills with counts and a toggle on click.
- **Restricted-visibility badge** on comments with a `LimitedVisibility` constraint (shows the group/user label on hover).
- **Activity feed** with inline edit on your own comments, VCS commits, and state/field changes rendered as semantic verbs. Work-item log-time form with a collapsible "Add time" trigger. Drag-and-drop attachments onto the panel.
- **Panel keyboard shortcuts**: `C` focus comment box · `R` toggle activity sort · `E` edit description · `?` show cheat sheet.
- Toolbar: **Start Work** (transition + branch), **Timer**, **Branch**, Refresh, Copy Link, Open in browser.

### Agile board
- Sprint picker, swimlane grouping (by Priority, Assignee, or State) or flat view, column sorting (recently updated / created / ID / summary).
- Drag cards across columns to transition state, with a dashed drop-zone outline and focus highlight while dragging.
- **Per-column `+` button** to create a new issue pre-seeded with that column's state.
- **In-memory filters**: text search (id/summary/tag) + Assignee / Priority / Tag dropdowns. Filters persist across sprint switches and window reloads.
- **Create Issue** button opens the form panel pre-selected to the current board's project.

### Create Issue
- Two-column form panel mirroring the detail shell. Project, Type, Priority, Assignee on the right; full Markdown editor on the left with the same toolbar/tabs as comments.
- **Create from editor selection**: right-click on selected code → **YouTrack: Create Issue from Selection**. Pre-fills summary with `filename.ts:42-58 — first line of snippet` and description with a fenced code block keyed to the document's language id.

### Time tracking
- Live timer with a status-bar item (per-second ticker) that persists across window reloads. Stopping rounds up and posts a work item automatically.
- Standalone **Log Time** form on the issue panel for manual entries, with configurable work-item types.

### Git integration
- **Branch from issue** with a configurable template — `youtrack.branch.template` supports `{id}`, `{summary}`, `{type}`, `{state}`, `{assignee}`, `{project}`, and `{field:<CustomFieldName>}` placeholders. Sanitized tokens (lowercase, diacritic-stripped, separator-joined) with a configurable length cap on `{summary}`.
- **Current-issue status-bar badge** that reads the current git branch, extracts the issue key, and shows `$(tasklist) ID` with a rich tooltip.
- **Branch-aware command palette**: `YouTrack: Go to Issue by ID`, `Transition State`, and friends pre-fill the input with the issue key from the current branch when you have no argument.
- **Commit message template**: when the current branch contains an issue key, the SCM input box auto-fills from `youtrack.commit.template` (default `{id}: `). Three auto-fill modes — `off`, `empty-only` (default, inserts once on branch change), `always` (re-inserts after each commit) — plus a manual `YouTrack: Insert Issue Key in Commit Message` command.
- **Post branch activity**: manual command that collects commits ahead of upstream on the current branch and posts them as a markdown bullet list comment on the linked issue (confirm / edit / cancel).

### Editor-surface affordances
- **Hover** any `ABC-123`-shaped token in any file → summary, state, assignee, quick-open link.
- **CodeLens** above any `TODO` / `FIXME` / `XXX` / `HACK` / `NOTE` comment referencing an issue key → `ABC-123 · In Progress · <summary>`; click opens the panel.
- **URI handler**: `vscode://valentinbeaumont.youtrack-vscode/ABC-123` opens the issue.

### Notifications
- Unread notifications render with a `bell-dot` icon; inline `✓` to mark one read or a **Mark All as Read** action in the view toolbar.

### Quality
- Strict CSP with per-load script nonces on every webview, `sanitize-html` on all rendered Markdown, no inline scripts, no `eval`.
- Friendly error handling: YouTrack Cloud's "read-only mode" (maintenance windows) renders as a single coalesced notice instead of raw JSON; 401/403 point to the sign-in command; other server errors render just the `error_description`.
- Caches (user avatars, field color dots) prune entries older than 30 days on startup to keep `globalStorage` lean.

## Keyboard shortcuts

### Global

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Create issue | `Ctrl+Alt+N` | `Cmd+Alt+N` |
| Go to issue by ID | `Ctrl+Alt+G` | `Cmd+Alt+G` |
| Search issues | `Ctrl+Alt+Y` | `Cmd+Alt+Y` |
| Open board | `Ctrl+Alt+B` | `Cmd+Alt+B` |

### Inside the issue panel

| Key | Action |
| --- | --- |
| `C` | Focus the new-comment box |
| `R` | Toggle activity-feed sort (oldest / newest first) |
| `E` | Edit description |
| `?` | Show the cheat sheet |

## Settings

Highlights (full list under **Settings → Extensions → YouTrack**):

| Setting | Default | What it does |
| --- | --- | --- |
| `youtrack.baseUrl` | — | YouTrack Cloud URL. |
| `youtrack.defaultProject` | — | Project short name used when creating issues. |
| `youtrack.branch.template` | `{assignee}/{id}-{summary}` | Branch-name template. Supports `{id}`, `{summary}`, `{type}`, `{state}`, `{assignee}`, `{project}`, `{field:<Name>}`. |
| `youtrack.branch.summaryMaxLength` | `40` | Character cap on the sanitized `{summary}` token. |
| `youtrack.branch.separator` | `-` | Separator inside sanitized tokens. |
| `youtrack.commit.template` | `{id}: ` | SCM input prefix. Put `{id}` anywhere. |
| `youtrack.commit.autoFill` | `empty-only` | `off` / `empty-only` / `always`. |
| `youtrack.cache.pollInterval` | `60` | Background refresh cadence (seconds). |

## Security

All webviews run under a restrictive CSP:

```
default-src 'none';
style-src  {webview}  'unsafe-inline';
font-src   {webview};
script-src 'nonce-<per-load>';
img-src    {webview}  https: data:;
connect-src {webview};
frame-src  'none';
```

No inline scripts, no `eval`, no third-party CDN assets. Rendered markdown (comments, descriptions, work-item notes) passes through `sanitize-html` with an explicit allow-list of tags and schemes before hitting the DOM.

## Develop

```bash
npm install
npm run build        # esbuild bundle → dist/extension.js
npm test             # vitest unit suite
npx vsce package     # → youtrack-vscode-<ver>.vsix
```

Pull requests welcome at [healkeiser/youtrack-vscode](https://github.com/healkeiser/youtrack-vscode).

## License

MIT. See [LICENSE](./LICENSE).

---

YouTrack and JetBrains are trademarks of JetBrains s.r.o. This extension is an independent community project and is not affiliated with, endorsed by, or sponsored by JetBrains.
