import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { CustomField, CustomFieldType, Issue } from '../client/types';
import { parseDuration } from '../domain/timeTracker';
import { showYouTrackError } from '../client/errors';
import { pickFieldValue, pickUser } from '../ui/pickers';
import { formatPeriod } from '../util/format';

// Interactive editor for any custom field on an issue. Dispatches on the
// field's type to the most appropriate VS Code input (QuickPick for
// enum/state/user/bool/version, InputBox for string/date/period/number).
// Returns true on successful write, false on cancel or error.
export async function editCustomField(
  client: YouTrackClient,
  cache: Cache,
  issueId: string,
  field: CustomField,
  project?: { id: string; shortName: string },
): Promise<boolean> {
  const projectId = project?.id;

  try {
    let newValue: string | number | boolean | null | undefined;

    switch (field.type) {
      case 'enum':
      case 'state':
      case 'version': {
        if (!projectId) {
          vscode.window.showWarningMessage(`YouTrack: can't edit ${field.name} without project context.`);
          return false;
        }
        const picked = await pickFieldValue(client, projectId, field.name, {
          title: `Change ${field.name}`,
          currentValue: currentText(field) === '—' ? undefined : currentText(field),
        });
        if (!picked) return false;
        newValue = picked.name;
        break;
      }
      case 'user': {
        const picked = await pickUser(client, `Change ${field.name}`, {
          allowClear: true,
          clearLabel: `Clear ${field.name}`,
          currentValue: currentText(field) === '—' ? undefined : currentText(field),
        });
        if (!picked) return false;
        newValue = picked.login;
        break;
      }
      case 'bool': {
        const picked = await vscode.window.showQuickPick(['Yes', 'No'], {
          title: `Set ${field.name}`,
          placeHolder: currentText(field),
        });
        if (!picked) return false;
        newValue = picked === 'Yes';
        break;
      }
      case 'date':
      case 'datetime': {
        const current = currentText(field);
        const prompt = field.type === 'datetime'
          ? 'Enter date+time (YYYY-MM-DD HH:mm) or blank to clear'
          : 'Enter a date (YYYY-MM-DD) or blank to clear';
        const input = await vscode.window.showInputBox({
          title: `Set ${field.name}`,
          prompt,
          value: current && current !== '—' ? current : '',
        });
        if (input === undefined) return false;
        if (!input.trim()) { newValue = null; break; }
        const parsed = Date.parse(input.trim());
        if (Number.isNaN(parsed)) {
          vscode.window.showErrorMessage('YouTrack: unrecognized date format.');
          return false;
        }
        newValue = parsed;
        break;
      }
      case 'period': {
        const input = await vscode.window.showInputBox({
          title: `Set ${field.name}`,
          prompt: 'Duration like "2h 30m", "45m", "3h"; blank to clear',
          value: currentText(field) === '—' ? '' : currentText(field),
        });
        if (input === undefined) return false;
        if (!input.trim()) { newValue = null; break; }
        const seconds = parseDuration(input);
        if (seconds == null) {
          vscode.window.showErrorMessage('YouTrack: could not parse duration.');
          return false;
        }
        newValue = seconds;
        break;
      }
      case 'string': {
        const input = await vscode.window.showInputBox({
          title: `Set ${field.name}`,
          value: currentText(field) === '—' ? '' : currentText(field),
        });
        if (input === undefined) return false;
        newValue = input;
        break;
      }
      case 'int':
      case 'float': {
        const input = await vscode.window.showInputBox({
          title: `Set ${field.name}`,
          prompt: field.type === 'int' ? 'Enter an integer (blank to clear)' : 'Enter a number (blank to clear)',
          value: currentText(field) === '—' ? '' : currentText(field),
          validateInput: (v) => {
            if (!v.trim()) return undefined;
            const n = Number(v);
            if (Number.isNaN(n)) return 'Not a number';
            if (field.type === 'int' && !Number.isInteger(n)) return 'Must be an integer';
            return undefined;
          },
        });
        if (input === undefined) return false;
        newValue = input.trim() ? Number(input) : null;
        break;
      }
      default: {
        vscode.window.showInformationMessage(`YouTrack: ${field.name} (${field.type}) is not editable here yet.`);
        return false;
      }
    }

    await client.setCustomField(issueId, field.name, field.type as Exclude<CustomFieldType, 'unknown'>, newValue as any);
    cache.invalidateIssue(issueId);
    return true;
  } catch (e) {
    showYouTrackError(e, `update ${field.name}`);
    return false;
  }
}

function currentText(f: CustomField): string {
  const v = f.value;
  switch (v.kind) {
    case 'empty':   return '—';
    case 'enum':    return v.name ?? '—';
    case 'state':   return v.name ?? '—';
    case 'user':    return v.login ?? '—';
    case 'string':  return v.text ?? '—';
    case 'date':    return v.iso ? new Date(v.iso).toISOString().slice(0, 10) : '—';
    case 'period':  return v.seconds ? formatPeriod(v.seconds) : '—';
    case 'number':  return String(v.value ?? '');
    case 'bool':    return v.value ? 'Yes' : 'No';
    case 'version': return v.name ?? '—';
    case 'unknown': return v.raw ?? '—';
  }
}


// Tiny helper the panel uses to find a field on a fresh issue fetch.
export async function editFieldByName(
  client: YouTrackClient,
  cache: Cache,
  issueId: string,
  fieldName: string,
): Promise<boolean> {
  let issue: Issue;
  try {
    issue = await cache.getIssue(issueId, (id) => client.fetchIssue(id));
  } catch {
    return false;
  }
  const field = issue.customFields.find((f) => f.name === fieldName);
  if (!field) {
    vscode.window.showWarningMessage(`YouTrack: field "${fieldName}" not found on ${issueId}.`);
    return false;
  }
  return editCustomField(client, cache, issueId, field, issue.project);
}
