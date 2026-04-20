import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { buildBranchName } from '../domain/branchNameBuilder';
import type { Issue } from '../client/types';

function issueToTemplateInput(issue: Issue) {
  const fields: Record<string, string> = {};
  let type = '', state = '';
  for (const f of issue.customFields) {
    const v = f.value;
    let raw = '';
    if (v.kind === 'enum' || v.kind === 'state') raw = v.name;
    else if (v.kind === 'string') raw = v.text;
    else if (v.kind === 'user') raw = v.fullName;
    else if (v.kind === 'version') raw = v.name;
    else if (v.kind === 'number') raw = String(v.value);
    else if (v.kind === 'bool') raw = v.value ? 'yes' : 'no';
    fields[f.name] = raw;
    if (f.name === 'Type') type = raw;
    if (f.name === 'State') state = raw;
  }
  return {
    idReadable: issue.idReadable,
    summary: issue.summary,
    type, state,
    assigneeLogin: issue.assignee?.login ?? '',
    projectShortName: issue.project.shortName,
    customFields: fields,
  };
}

export async function createBranch(client: YouTrackClient, cache: Cache, issueId: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('youtrack.branch');
  const template = cfg.get<string>('template', '{assignee}/{id}-{summary}');
  const maxLen = cfg.get<number>('summaryMaxLength', 40);
  const separator = cfg.get<string>('separator', '-');
  const copyOnly = cfg.get<boolean>('copyOnly', false);

  const issue = await cache.getIssue(issueId, (id) => client.fetchIssue(id));
  const name = buildBranchName({
    issue: issueToTemplateInput(issue),
    template, summaryMaxLength: maxLen, separator,
  });

  if (copyOnly) {
    await vscode.env.clipboard.writeText(name);
    vscode.window.showInformationMessage(`YouTrack: branch name copied: ${name}`);
    return;
  }

  const gitExt = vscode.extensions.getExtension<any>('vscode.git');
  if (!gitExt) {
    await vscode.env.clipboard.writeText(name);
    vscode.window.showWarningMessage(`Git extension unavailable. Branch name copied: ${name}`);
    return;
  }
  const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
  const api = git.getAPI(1);
  const repo = api.repositories[0];
  if (!repo) {
    vscode.window.showErrorMessage('YouTrack: no git repository in workspace');
    return;
  }
  await repo.createBranch(name, true);
  vscode.window.showInformationMessage(`YouTrack: checked out ${name}`);
}
