# Changelog

All notable changes to this extension are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Distribution change — 2026-05-05

The extension is being republished under a new Marketplace publisher: **`healkeiser`**.

The previous publisher slug `valentinbeaumont` is retired and dormant. Existing installs of `valentinbeaumont.youtrack-vscode` or `valentinbeaumont.youtrack-companion` no longer receive updates — both listings were removed from the Marketplace prior to this republish. Users on the old identifier should uninstall it and install `healkeiser.youtrack-companion`. All settings under the `youtrack.*` namespace are preserved across the switch.

The extension is also now distributed via [Open VSX](https://open-vsx.org/extension/healkeiser/youtrack-companion) (for VSCodium, Cursor, Theia, Gitpod) and direct [GitHub Releases](https://github.com/healkeiser/youtrack-companion/releases) for manual / air-gapped installs.

## [0.9.0] — 2026-04-28

### Changed
- **Rebranded to "YouTrack Companion"** to differentiate from other YouTrack extensions on the VS Marketplace. New `displayName`, new package `name` (`youtrack-companion`), new extension identifier (`valentinbeaumont.youtrack-companion`).
- **New icon** — replaced the JetBrains-style YouTrack mark with a distinct compass-rose monogram. Both Marketplace tile (`media/youtrack-companion.png`) and activity-bar glyph (`media/youtrack-companion_outline.svg`) updated.

### Notes
- The previous identifier `valentinbeaumont.youtrack-vscode` is unpublished. Existing users should install `valentinbeaumont.youtrack-companion` and uninstall the old one. All settings under the `youtrack.*` namespace are preserved.

## [0.8.0] — 2026-04-22

### Added
- **Subtasks section** on the issue panel with a live `done / total` progress bar and clickable child-issue rows.
- **Per-column `+ New` button** on the Agile board — creates an issue pre-seeded to that column's state.
- **Keyboard shortcuts inside the issue panel**: `C` focus comment box, `R` toggle activity sort, `E` edit description, `?` show cheat sheet.
- **Restricted-visibility badge** on comments with `LimitedVisibility` (group/user label on hover).
- **VCS commits in the activity feed** — `pushed commit <hash>` entries rendered alongside state transitions and field changes.
- **Drop-zone affordance** on the Agile board — dashed outline + focus highlight while dragging a card.
- **Branch-aware command palette** — `Go to Issue by ID`, `Transition State`, etc. pre-fill the input with the issue key parsed from the current git branch (fallback: token under the cursor).

### Changed
- Comment reaction endpoint polish; restricted-visibility rendering pulls `permittedGroups` / `permittedUsers` metadata.
- README rewritten with Marketplace badges, Quick Start, keyboard-shortcut tables, and a `docs/screenshots/` section.
- Attachment `byName` maps memoized once per render (instead of per comment) — faster rendering on heavy threads.
- Avatar and color-dot caches prune entries older than 30 days on startup to keep `globalStorage` small.

### Removed
- Dead `fieldRenderer.ts` module.

## [0.7.0] — 2026-04-22

Major UX + content overhaul. Everything below is new since 0.4.1.

### Added — Editing surfaces
- **Inline pickers everywhere.** Every side-panel pill (State, Priority, Assignee, user custom fields, enum/version/state custom fields, Tags, Links, Work Item Type) opens a VS Code-styled dropdown anchored directly under the clicked pill. Features: search input, arrow-key navigation, Enter to pick, Esc / click-outside to close. Visual fidelity: colored dots for enum/priority using the YouTrack-configured hex, avatars for users loaded from the direct HTTPS URL, codicons + theme colors for state (matching the sidebar), `$(check)` multi-select checkmarks for Tags, action rows (Unassign / Clear / Create new tag) above a thin separator.
- **Inline inputs for date, datetime, period, string, integer, float, bool** with the same anchored-dropdown UX. Date fields use a native `<input type="date">`; datetime fields use `datetime-local` and only appear when YouTrack reports the field as `DateTimeIssueCustomField`; period fields accept `1h 30m` / `45m` / `3h` syntax; numeric fields validate as you type; bool fields show a two-item Yes/No picker.
- **Name-based date detection** — fields like `End date`, `Start date`, `Timer time`, `Due date` get a date picker even when YouTrack stores them as bare `SimpleIssueCustomField` integers. Epoch-ms heuristic looks at UTC midnight to decide date vs datetime.
- **Tags can be created inline** — a `$(add) Create new tag…` row at the top of the tag multi-select opens a tiny name prompt, creates the tag, attaches it to the current issue, and re-renders.
- **Issue link editor** — Manage Links row on the side panel opens an inline picker listing each existing link (with a trash remove action) followed by every available link-type verb. Adding a link prompts for a target issue ID and POSTs through YouTrack's `/api/commands` endpoint.
- **Colored dots match YouTrack** — State / Priority / enum pickers and pills render dots / codicons tinted with the exact hex YouTrack has configured, not bucketed theme colors.
- **Avatars in user pickers** — Change Assignee, user-field edit, and @mention pickers show each user's YouTrack profile picture with a generic `person` codicon fallback.
- **Sort toggle for Comments + Activity** — a small `Newest first ↕ / Oldest first ↕` button in the Comments section header flips the sort direction for both streams at once; the preference persists across panels via `globalState`.

### Added — Comments
- **Comment-as-card layout** — each comment sits in its own soft rounded surface with a 32px avatar gutter on the left, author + verb + relative time in the header, body below. Activity feed (work items + field changes) uses the same card treatment with uniform 28px avatars. Relative time (`3h ago`, `2d ago`) with full datetime on hover.
- **Full activity feed** with field changes — the Activity section merges comments, work items, and field-change history (state transitions, priority changes, tag add/remove, link add/remove, attachment changes, sprint moves, resolution) from YouTrack's `/activities` stream.
- **Comment attachments** bind to the comment, not the issue — clicking the paperclip (or pasting a screenshot) into the Add-a-Comment form queues files in memory and renders a preview tile below the textarea. On post, the comment is created first, then each file uploads directly to `POST /api/issues/{id}/comments/{commentId}/attachments` so YouTrack links them properly (they render as tiles under the comment, matching the web UI — never inlined as markdown).
- **Attachment thumbnails inside comments** — second-pass HTML rewrite resolves `<img src="filename.ext">` and `<a href="filename.ext">` references to the full signed URL regardless of how YouTrack stored the reference.
- **Inline image lightbox gallery** — click any image attachment (global or inline-in-comment) to open a fixed-position overlay with the full-size image, caption, thumbnail strip, previous/next arrow buttons, keyboard navigation (`←` / `→` / `Esc`), and scroll-into-view for the active thumbnail. Single-image attachments just show the large image with no strip.

### Added — Layout & spacing
- **Full-width separators** under every section heading (Description / Attachments / Comments / Activity). **Details** heading on Create Issue mirrors the Issue Detail side panel.
- **Section icons** — every labeled section has a codicon in its title (`file-media` for Attachments, `comment-discussion` for Comments, `history` for Activity, `clock` for Log time, `note` for Description, `info` for Details).
- **Cohesive spacing** — both panels use the same `.main { display: flex; gap }` rhythm and identical side-panel layout (360px column, 110px label width).
- **Attachments grid scrolls horizontally** — always a single row, overflow-x: auto, instead of wrapping into rows that push the rest of the panel down.
- **Estimate progress bar is readable when over-budget** — white label with drop-shadow for legibility on any fill color; shows `+NN%` bold when over.
- **Small-window layout** — on narrow panels (<880px), the layout collapses to a single column with Details at the bottom (previously hoisted above main).

### Added — Agile board
- **Sprint / Group / Color by / filters persist across sessions** — the board's layout prefs survive panel close + VS Code restart, keyed per-board via `globalState`.
- **Color by field** — pick which field drives the card's left-border accent (State / Priority / None). Uses the YouTrack-configured bundle color, not bucketed theme colors.
- **Open Board in Browser** — new `$(link-external)` icon in the board header and as an inline action on each sidebar Boards tree item.
- **Sprintless boards** — boards with the "Disable sprints" admin option are still listed (with a `no sprints` annotation in the picker); the sprint dropdown is hidden on those boards and the Open-in-Browser URL drops the sprint segment.

### Added — Issue creation
- **Create Issue drafts** — summary, description, selected tags, project/type/priority/assignee persist to `globalState` and are restored if you reopen the panel; cleared on successful submit.
- **Workspace issue templates** — drop markdown files into `.youtrack/templates/` in any workspace folder; they appear in a new **Template** dropdown. First `# Title` line becomes the summary, rest becomes the description.
- **Same picker/input affordances** as Issue Detail — Create Issue's Project, Type, Priority, Assignee, Tags all use the inline picker with the same visual treatment.

### Added — Workflow
- **My Weekly Worklog** — `YouTrack: My Weekly Worklog` lists your work items since Monday, grouped by issue with totals; pick any row to open that issue.
- **Peek issue** — place the cursor on an `ABC-123` token and press `Ctrl+Alt+P` / `Cmd+Alt+P` to open the issue beside the current view without stealing focus.
- **Get Started walkthrough** — first-run walkthrough (Sign in → Open first issue → Branch → Customize) under **Welcome → Walkthroughs**.

### Fixed
- Pickers commit on **pointerdown** — click events aren't reliably dispatched inside VS Code webviews for elements under a `position: fixed` container, so delegated click-based picks were silently lost. pointerdown fires consistently.
- Attaching via the comment toolbar no longer reloads the panel mid-edit, so in-flight comment drafts survive.
- Attachment tile click opens the lightbox cleanly instead of also launching a browser tab (we render tiles as `<div data-href>` rather than `<a href>` so there's no default navigation to suppress).
- State pills render with icon + text vertically centered via a shared `.icon-label` inline-flex container.
- DateTime fields display their time component ("16 Apr 2026, 08:22") instead of the date alone.
- Bundle-value pickers (State / Priority / enum fields) sort by the admin-configured `ordinal` position so order matches YouTrack.
- Sidebar tree icons unified — Assigned to me and Issues views share the same codicon + theme-color rendering.

### Changed
- `changeState`, `changePriority`, `changeAssignee`, `editCustomField` delegate to shared `pickers.ts` helpers — single source of truth for native QuickPick paths.
- Consolidated `formatPeriod`, `formatBytes`, `escapeHtml` into `src/util/format.ts`; `stateVisuals` into `src/util/stateVisuals.ts`.
- `inlineInput` merged into `inlinePicker.js` as `YT.inlinePicker.openInput` — one file, one positioning/close code path.

## [0.6.0] — 2026-04-21

### Added
- **Inline picker** — anchored dropdown that replaces top-of-screen QuickPicks for pill clicks on both Issue Detail and Create Issue panels. Single-select for State/Priority/Assignee/enum custom fields; multi-select with checkmarks for Tags; actions-only mode for Links management. Supports arrow-key navigation, search, and flips above the pill if there isn't enough room below.
- **State icons match the sidebar** — same codicon + theme color (`pass-filled`/`sync`/`eye`/`circle-slash`/`debug-pause`) across the tree, pills, and inline picker.
- **Log time → Type** is now an inline picker pill instead of a raw `<select>`.
- **Cohesive spacing** — both panels use the same `.main { display: flex; gap }` rhythm and identical side-panel layout (360px column, 110px label width).

### Fixed
- Attaching via the comment toolbar no longer reloads the panel mid-edit, so in-flight comment drafts survive.
- State / Priority pills now render with icon + text properly centered (`.icon-label` inline-flex).

## [0.5.0] — 2026-04-21

### Added
- **Full activity feed.** The Activity section now merges comments, work-item logs, *and* field-change history (state transitions, assignment changes, priority bumps, summary/description edits, tag add/remove, link add/remove, attachment add/remove, sprint moves, project moves, resolution) from YouTrack's `/activities` stream into a single chronological feed.
- **Issue link editor.** A **Manage…** row at the bottom of the links section opens a QuickPick listing every existing link with a `$(trash)` remove action, followed by every available link-type verb (e.g. "depends on", "is duplicated by", "relates to") as an add action. Adding prompts for a target issue ID. New command: `YouTrack: Manage Issue Links…`.
- **Paste screenshot → attachment.** Pasting an image (from a screenshot tool, clipboard, or file) into any markdown textarea (description/comment/edit) on the Issue Detail panel uploads it as an attachment and inserts `![filename](url)` at the cursor.
- **My Weekly Worklog.** New command `YouTrack: My Weekly Worklog` lists your work items since Monday, grouped by issue with per-issue totals and a grand total at the top; pick any row to open that issue.
- **Create Issue drafts.** Summary, description, selected tags, project/type/priority/assignee now persist to `globalState` and are restored if you reopen the Create Issue panel. Cleared on successful create.
- **Workspace issue templates.** Drop markdown files into `.youtrack/templates/` in your workspace; they appear in a new **Template** dropdown on the Create Issue panel. The first `# Title` line becomes the summary; the rest becomes the description.
- **Estimate progress bar.** When an issue has an Estimation period field, the side panel renders a `<spent> / <estimate> · <pct>%` bar under it, sourced from the sum of logged work items. Turns red when you blow past the estimate.
- **Peek issue.** Place the cursor on an `ABC-123` token in any file and press `Ctrl+Alt+P` / `Cmd+Alt+P` (or run `YouTrack: Peek Issue Under Cursor`) to open the issue in a side column without stealing focus.
- **Get Started walkthrough.** First-run walkthrough (`contributes.walkthroughs`) with four steps: Sign in, Open first issue, Branch from issue, Customize. Visible under **Welcome → Walkthroughs → Get Started with YouTrack**.

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

[0.7.0]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.7.0
[0.6.0]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.6.0
[0.5.0]: https://github.com/healkeiser/youtrack-vscode/releases/tag/v0.5.0
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
