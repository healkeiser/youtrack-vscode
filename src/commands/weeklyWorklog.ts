import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { showYouTrackError } from '../client/errors';
import { formatPeriod } from '../util/format';

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();            // 0 = Sun, 1 = Mon, ...
  const diff = (day + 6) % 7;           // days since Monday
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Queries the user's work items over the last N days, buckets by issue +
// day, and renders an informational QuickPick summarising the week. The
// pick is non-actionable (selecting an item opens that issue).
export async function showWeeklyWorklog(client: YouTrackClient): Promise<void> {
  try {
    const me = await client.getMe();
    if (!me?.login) {
      vscode.window.showErrorMessage('YouTrack: not signed in.');
      return;
    }
    const from = startOfWeek(new Date()).getTime();
    const items = await client.fetchMyWorkItemsSince(me.login, from);
    if (!items.length) {
      vscode.window.showInformationMessage('YouTrack: no time logged this week.');
      return;
    }

    // Bucket per issue
    type Bucket = { issueId: string; summary: string; totalSeconds: number };
    const byIssue = new Map<string, Bucket>();
    let grand = 0;
    for (const w of items) {
      grand += w.duration;
      const key = w.issueId ?? '';
      const b = byIssue.get(key) ?? { issueId: key, summary: w.issueSummary ?? '', totalSeconds: 0 };
      b.totalSeconds += w.duration;
      byIssue.set(key, b);
    }

    type Item = vscode.QuickPickItem & { issueId?: string };
    const items2: Item[] = [...byIssue.values()]
      .sort((a, b) => b.totalSeconds - a.totalSeconds)
      .map((b) => ({
        label: `${b.issueId} · ${formatPeriod(b.totalSeconds)}`,
        description: b.summary,
        issueId: b.issueId,
      }));
    items2.unshift(
      { label: `Total this week: ${formatPeriod(grand)}`, kind: vscode.QuickPickItemKind.Separator } as any,
    );

    const picked = await vscode.window.showQuickPick<Item>(items2, {
      title: 'Worklog — this week',
      placeHolder: 'Select an issue to open',
      matchOnDescription: true,
    });
    if (picked?.issueId) {
      vscode.commands.executeCommand('youtrack.openIssue', picked.issueId);
    }
  } catch (e) {
    showYouTrackError(e, 'fetch worklog');
  }
}
