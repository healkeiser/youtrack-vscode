import type { CustomField, CustomFieldValue } from '../client/types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPeriod(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function valueToString(v: CustomFieldValue): string {
  switch (v.kind) {
    case 'empty':   return '—';
    case 'enum':    return v.name;
    case 'state':   return v.name;
    case 'user':    return v.fullName;
    case 'string':  return v.text;
    case 'date':    return new Date(v.iso).toLocaleDateString();
    case 'period':  return formatPeriod(v.seconds);
    case 'number':  return String(v.value);
    case 'bool':    return v.value ? 'Yes' : 'No';
    case 'version': return v.name;
    case 'unknown': return v.raw;
  }
}

export function renderField(f: CustomField): string {
  const display = escapeHtml(valueToString(f.value));
  const name = escapeHtml(f.name);
  const readonly = f.type === 'unknown' ? ' readonly' : '';
  return `<div class="field" data-field="${name}"${readonly}>
    <label>${name}</label>
    <span class="value">${display}</span>
  </div>`;
}
