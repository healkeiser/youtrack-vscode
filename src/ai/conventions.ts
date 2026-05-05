import * as vscode from 'vscode';

// Compact markdown block describing the user's branch + commit
// conventions, derived from `youtrack.branch.*` / `youtrack.commit.*`
// settings. We hand this to any agent that proposes branch names or
// commit messages so they match what `Create Branch` would produce.
//
// Kept short on purpose: the model already knows what slugification is.
// The example is computed by the same slug rules the extension uses, so
// the agent has a worked output to anchor on.
export function buildConventions(): string {
  const branch = vscode.workspace.getConfiguration('youtrack.branch');
  const commit = vscode.workspace.getConfiguration('youtrack.commit');

  const template = branch.get<string>('template', '{assignee}/{id}-{summary}');
  const separator = branch.get<string>('separator', '-');
  const summaryMaxLength = branch.get<number>('summaryMaxLength', 40);
  const commitTemplate = commit.get<string>('template', '{id}: ');

  const example = exampleBranch(template, separator, summaryMaxLength);
  const placeholders = '`{id}`, `{summary}`, `{type}`, `{state}`, `{assignee}`, `{project}`, `{field:<Name>}`';

  return [
    '## Conventions',
    `- **Branch template:** \`${template}\` (separator \`${separator}\`, \`{summary}\` ≤ ${summaryMaxLength} chars).`,
    `- All tokens except \`{id}\`, \`{assignee}\`, \`{project}\` are slugified (NFKD strip diacritics, lowercase, non-alphanumerics → \`${separator}\`, trim).`,
    `- Placeholders: ${placeholders}.`,
    `- Example: ABC-123 "Fix Login Crash!" assigned to alice → \`${example}\`.`,
    `- **Commit prefix:** \`${escapeBackticks(commitTemplate)}\` on the subject line; \`{id}\` becomes the issue id.`,
  ].join('\n');
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, '\\`');
}

// Mirror of src/domain/branchNameBuilder.ts so the example we show the
// model is byte-for-byte what `Create Branch` would emit for the same
// settings.
function slugify(raw: string, sep: string, maxLen?: number): string {
  if (!raw) return '';
  let s = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, sep);
  const escaped = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(`${escaped}+`, 'g'), sep);
  s = s.replace(new RegExp(`^${escaped}|${escaped}$`, 'g'), '');
  if (maxLen !== undefined && s.length > maxLen) {
    s = s.slice(0, maxLen).replace(new RegExp(`${escaped}+$`, 'g'), '');
  }
  return s;
}

function exampleBranch(template: string, sep: string, maxLen: number): string {
  const sample: Record<string, string> = {
    id: 'ABC-123',
    summary: slugify('Fix Login Crash!', sep, maxLen),
    type: slugify('Bug', sep),
    state: slugify('In Progress', sep),
    assignee: 'alice',
    project: 'ABC',
  };
  return template.replace(/\{([^}]+)\}/g, (_m, key: string) => {
    if (key.startsWith('field:')) return slugify('example', sep);
    return sample[key] ?? '';
  });
}
