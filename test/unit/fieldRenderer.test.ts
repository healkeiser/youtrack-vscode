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
