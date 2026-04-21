import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { showYouTrackError } from '../client/errors';

const ISSUE_PATTERN = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

interface GitCommit {
  hash: string;
  message: string;
  authorName?: string;
  authorDate?: Date;
}

// Manually-invoked companion to the current-issue badge. Finds the
// current branch, extracts the issue key, lists commits ahead of the
// upstream (or ahead of main/master as a fallback), builds a markdown
// summary, and — after user confirmation — posts it as a comment.
//
// Manual-trigger is by design: the VS Code Git API does not expose a
// push event, and auto-posting on every branch state change would be
// noisy. Users run this once per meaningful push.
export async function postBranchActivity(
  client: YouTrackClient,
  cache: Cache,
): Promise<void> {
  const repo = getPrimaryRepo();
  if (!repo) {
    vscode.window.showWarningMessage('YouTrack: no Git repository is currently open.');
    return;
  }

  const branch: string | undefined = repo.state?.HEAD?.name;
  if (!branch) {
    vscode.window.showWarningMessage('YouTrack: current branch could not be determined.');
    return;
  }

  const match = ISSUE_PATTERN.exec(branch);
  if (!match) {
    vscode.window.showWarningMessage(`YouTrack: no issue key found in branch "${branch}".`);
    return;
  }
  const issueId = match[1];

  const commits = await collectRecentCommits(repo);
  if (!commits.length) {
    vscode.window.showInformationMessage('YouTrack: no commits ahead of upstream on this branch.');
    return;
  }

  const lines = commits.map((c) => {
    const short = c.hash.slice(0, 7);
    const subject = (c.message.split(/\r?\n/)[0] || '').trim();
    return `- \`${short}\` — ${subject}`;
  });
  const body = [
    `Pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} on \`${branch}\`:`,
    '',
    ...lines,
  ].join('\n');

  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(check) Post comment', id: 'post' },
      { label: '$(edit) Edit first', id: 'edit' },
      { label: '$(x) Cancel', id: 'cancel' },
    ],
    {
      title: `Post ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${issueId}?`,
      placeHolder: commits[0].message.split(/\r?\n/)[0]?.slice(0, 60) ?? '',
    },
  );
  if (!picked || picked.id === 'cancel') return;

  let finalBody = body;
  if (picked.id === 'edit') {
    const edited = await vscode.window.showInputBox({
      title: `Comment for ${issueId}`,
      value: body,
      prompt: 'Edit the comment before posting.',
    });
    if (edited === undefined) return;
    finalBody = edited;
  }

  try {
    await client.addComment(issueId, finalBody);
    cache.invalidateIssue(issueId);
    vscode.window.showInformationMessage(`YouTrack: posted to ${issueId}.`);
  } catch (e) {
    showYouTrackError(e, 'post comment');
  }
}

function getPrimaryRepo(): any | undefined {
  const gitExt = vscode.extensions.getExtension<any>('vscode.git');
  if (!gitExt?.isActive) return undefined;
  try {
    const api = gitExt.exports.getAPI(1);
    return api.repositories?.[0];
  } catch {
    return undefined;
  }
}

// Best-effort commit range.
//   1. If the branch has an upstream AND the AheadBehind reports N > 0,
//      ask the Git API for the top N commits — those are the ones ahead.
//   2. Otherwise, diff against the repository's default branch (main or
//      master); this covers the "first push of a feature branch before
//      upstream exists" case.
//   3. If neither works, fall back to the last 5 commits on HEAD — better
//      to post *something* than nothing.
async function collectRecentCommits(repo: any): Promise<GitCommit[]> {
  const ahead: number | undefined = repo.state?.HEAD?.ahead;
  if (typeof ahead === 'number' && ahead > 0) {
    const out = await tryLog(repo, { maxEntries: ahead });
    if (out.length) return out;
  }

  const fallbackBase = await pickFallbackBase(repo);
  if (fallbackBase) {
    const out = await tryLog(repo, { range: `${fallbackBase}..HEAD`, maxEntries: 50 });
    if (out.length) return out;
  }

  return tryLog(repo, { maxEntries: 5 });
}

async function pickFallbackBase(repo: any): Promise<string | undefined> {
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      await repo.getCommit?.(candidate);
      return candidate;
    } catch { /* try next */ }
  }
  return undefined;
}

async function tryLog(repo: any, opts: { maxEntries?: number; range?: string }): Promise<GitCommit[]> {
  try {
    const result = await repo.log?.(opts);
    if (!Array.isArray(result)) return [];
    return result.map((c: any) => ({
      hash: String(c.hash ?? ''),
      message: String(c.message ?? ''),
      authorName: c.authorName,
      authorDate: c.authorDate instanceof Date ? c.authorDate : undefined,
    })).filter((c: GitCommit) => c.hash);
  } catch {
    return [];
  }
}
