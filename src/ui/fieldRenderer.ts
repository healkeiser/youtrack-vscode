import type { CustomField, CustomFieldValue } from '../client/types';
import { escapeHtml, formatPeriod } from '../util/format';

function valueToString(v: CustomFieldValue): string {
  switch (v.kind) {
    case 'empty':   return '—';
    case 'enum':    return v.name ?? '—';
    case 'state':   return v.name ?? '—';
    case 'user':    return v.fullName ?? v.login ?? '—';
    case 'string':  return v.text ?? '—';
    case 'date':    return v.iso ? new Date(v.iso).toLocaleDateString() : '—';
    case 'period':  return formatPeriod(v.seconds);
    case 'number':  return String(v.value ?? 0);
    case 'bool':    return v.value ? 'Yes' : 'No';
    case 'version': return v.name ?? '—';
    case 'unknown': return v.raw ?? '—';
  }
}

export function renderField(f: CustomField): string {
  const display = escapeHtml(valueToString(f.value));
  const name = escapeHtml(f.name ?? '');
  const readonly = f.type === 'unknown' ? ' readonly' : '';
  return `<div class="field" data-field="${name}"${readonly}>
    <label>${name}</label>
    <span class="value">${display}</span>
  </div>`;
}
