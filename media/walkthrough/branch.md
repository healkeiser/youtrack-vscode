# Branch from an issue

On any issue in the sidebar, right-click → **Create Branch**, or use the toolbar button on the detail panel.

The branch name follows `youtrack.branch.template` (default `{assignee}/{id}-{summary}`). Placeholders:
`{id}`, `{summary}`, `{type}`, `{state}`, `{assignee}`, `{project}`, `{field:<CustomFieldName>}`.

Once you're on a branch whose name contains the issue key, the **Commit Message** input box auto-fills with `{id}: ` (configurable). A status-bar badge shows the current ticket at all times.
