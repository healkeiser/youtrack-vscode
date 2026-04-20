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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
