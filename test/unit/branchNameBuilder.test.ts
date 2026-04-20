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
