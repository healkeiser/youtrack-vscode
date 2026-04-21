# Changelog

All notable changes to this extension are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.1] — 2026-04-21

### Added
- **Tag editing** on both existing and new issues. Click the **Tags** row on the Issue Detail panel to open a multi-select picker of all visible tags (currently-attached ones are pre-checked); confirm to apply the add/remove diff in one shot. Same picker on the Create Issue panel attaches selected tags immediately after the issue is created. A top **Create new tag…** entry lets you mint a new tag without leaving the flow. New command: `YouTrack: Edit Tags...`.
- **Colored dots in State / Priority / enum-field pickers** — the actual hex YouTrack has configured for each value is rendered as a 16×16 SVG dot, cached per-hex under the extension's global storage. Works identically across light and dark themes.
- **Avatars in user pickers** — Change Assignee, user-field edit, and @mention pickers now show each user's YouTrack profile picture. Avatars are downloaded on first use and cached to disk; users without an avatar fall back to a generic person icon.
- Separator + icon on action items across pickers (Unassign, Clear assignee, Create new tag) so they're visually distinct from the data rows.

### Changed
- User pickers (Change Assignee, @mention) now show full name as the prominent label with login as the dim description, matching the user-field edit picker.
- `.editable-pill` hover styling moved to shared CSS so the Create Issue panel's Tags row gets the same subtle hover highlight as the Issue Detail panel.

## [0.4.0] — 2026-04-21

### Added
- **Attachment thumbnails & picker:** image attachments render as thumbnail tiles (click to open full size), non-images as file cards with codicon + name + size. A new **Attach** button in the Attachments section opens a native file picker (multi-select); drag-and-drop onto the panel still works, now hinted by an empty-state message.

## [0.3.5] — 2026-04-21

### Added
- Refresh button on the Issue Detail toolbar (invalidates the issue cache entry and re-runs reload).

## [0.3.4] — 2026-04-21

### Changed
- Marketplace `displayName` is now `YouTrack` (dropped "for VS Code").

## [0.3.3] — 2026-04-21

### Added
- Friendly error formatting across every write path. Read-only-mode responses from YouTrack Cloud (maintenance windows) now surface as a single coalesced notice instead of the raw HTTP 418 JSON; 401/403 point users at the sign-in command; other errors render just the server's `error_description`.

## [0.3.2] — 2026-04-21

### Fixed
- Agile board now sits flush against the filter row and the viewport edges — dropped the `.board` padding that was creating a ring of whitespace on all four sides.

## [0.3.1] — 2026-04-21

### Fixed
- Agile board column dividers no longer break at the header/body seam; the filter row's separator now runs edge-to-edge.

## [0.3.0] — 2026-04-21

### Added
- **Agile board filters:** second header row with text search and dropdowns for assignee, priority, and tag. Filtering is in-memory; selections persist across sprint switches.
- **Create Issue from Selection:** right-click on selected code → opens Create Issue pre-filled with a fenced code block and a path/line header.
- **Commit message template:** two new settings (`youtrack.commit.template` with `{id}` placeholder, `youtrack.commit.autoFill` = `off` / `empty-only` / `always`) drive auto-insertion of the branch's issue key into the SCM commit box. Manual `YouTrack: Insert Issue Key in Commit Message` command is always available.

## [0.2.3] — 2026-04-21

### Fixed
- Integer custom fields whose name looks date-ish (`Start date`, `End date`, `Timer time`, …) and whose value is in the plausible epoch-ms range are now rendered as formatted local dates instead of raw numbers.

## [0.2.0] — 2026-04-21

### Added
- **CodeLens** above any `TODO` / `FIXME` / `XXX` / `HACK` / `NOTE` that references an issue key — shows `<ID> · <state> · <summary>` and opens the Issue Detail panel on click.
- **Notifications mark-as-read** — per-item inline `✓` and a "Mark All as Read" view-toolbar action; unread notifications show a `bell-dot` icon.
- **Comment draft persistence** — add-comment textareas are auto-saved to `globalState` per issue; drafts survive panel close, reload, or accidental Ctrl+W.
- **@mention autocomplete** — typing `@<prefix>` in any comment/edit textarea pops a VS Code-styled dropdown over the cached user roster; arrow keys navigate, Enter/Tab accepts.
- **Quick-edit for every custom field** — every side-panel row is now a clickable pill that opens a type-aware editor (QuickPick for enum/state/user/version/bool, InputBox for string/date/period/number).
- **Post Branch Activity** — manual command that extracts the issue key from the current branch, summarizes the commits ahead of upstream, and posts the markdown bullet list as a comment (confirm / edit / cancel).

## [0.1.x]

### Added
- Activity bar view container with five sidebar views: Notifications, Assigned to me, Recents, Issues, Agile Boards.
- Issue Detail webview: editable summary/description with markdown Write/Preview, clickable side-panel pills for State/Priority/Assignee, comment thread with inline edit for your own comments, work-item log-time form, drag-drop attachment upload, issue-link chips, @-mention resolution with full names.
- Agile board webview with swimlanes, sprint picker, sortable columns, drag-to-column state transitions.
- Create Issue two-column form panel with Project / Type / Priority / Assignee side panel and a full-width description editor.
- Live timer service with status-bar item and per-second ticker, persisted across reloads.
- Current-issue status-bar badge driven by the git branch.
- Hover provider for issue keys in any file.
- Branch-from-issue flow with a configurable `youtrack.branch.template` (`{id}`, `{summary}`, `{type}`, `{state}`, `{assignee}`, `{project}`, `{field:<Name>}` placeholders).
- Security hardening: strict CSP with per-load nonces on every webview, `sanitize-html` on all rendered markdown.

[0.4.1]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.4.1
[0.4.0]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.4.0
[0.3.5]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.3.5
[0.3.4]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.3.4
[0.3.3]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.3.3
[0.3.2]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.3.2
[0.3.1]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.3.1
[0.3.0]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.3.0
[0.2.3]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.2.3
[0.2.0]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.2.0
