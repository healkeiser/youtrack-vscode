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
