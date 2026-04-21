import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import { showYouTrackError } from '../client/errors';

const STATE_KEY = 'youtrack.activeTimer';

interface ActiveTimer {
  issueId: string;
  startedAt: number;
}

export class TimerService implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private tick: NodeJS.Timeout | undefined;

  constructor(private context: vscode.ExtensionContext, private client: YouTrackClient) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.item.command = 'youtrack.timerClick';
    this.item.name = 'YouTrack Timer';
    this.render();
    if (this.activeTimer()) this.startTick();
  }

  activeTimer(): ActiveTimer | null {
    return this.context.globalState.get<ActiveTimer | null>(STATE_KEY, null);
  }

  async start(issueId: string): Promise<void> {
    const existing = this.activeTimer();
    if (existing) {
      const pick = await vscode.window.showWarningMessage(
        `A timer is already running on ${existing.issueId}. Stop it and start a new one on ${issueId}?`,
        'Stop and switch', 'Cancel',
      );
      if (pick !== 'Stop and switch') return;
      await this.stop(/* logSpecifiedIssue */ existing.issueId);
    }
    await this.context.globalState.update(STATE_KEY, { issueId, startedAt: Date.now() } satisfies ActiveTimer);
    this.render();
    this.startTick();
    vscode.window.showInformationMessage(`YouTrack: timer started on ${issueId}`);
  }

  async stop(overrideIssueId?: string): Promise<void> {
    const t = this.activeTimer();
    if (!t) {
      vscode.window.showInformationMessage('YouTrack: no timer running');
      return;
    }
    const elapsedMs = Date.now() - t.startedAt;
    const elapsedSec = Math.max(60, Math.round(elapsedMs / 1000)); // enforce at least 1 min
    const targetId = overrideIssueId ?? t.issueId;

    await this.context.globalState.update(STATE_KEY, null);
    this.render();
    this.stopTick();

    const pick = await vscode.window.showInformationMessage(
      `YouTrack: log ${formatDuration(elapsedSec)} on ${targetId}?`,
      'Log', 'Discard',
    );
    if (pick !== 'Log') {
      vscode.window.showInformationMessage(`YouTrack: timer discarded (${formatDuration(elapsedSec)} not logged)`);
      return;
    }
    try {
      await this.client.addWorkItem(targetId, {
        durationSeconds: elapsedSec,
        date: Date.now(),
      });
      vscode.window.showInformationMessage(`YouTrack: logged ${formatDuration(elapsedSec)} on ${targetId}`);
    } catch (e) {
      showYouTrackError(e, 'log time');
    }
  }

  async toggleFromStatusBar(): Promise<void> {
    const t = this.activeTimer();
    if (!t) {
      vscode.window.showInformationMessage('YouTrack: no timer running. Start one from an issue detail panel.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      [
        { label: `$(debug-stop) Stop and log — ${t.issueId}`, action: 'stop' as const },
        { label: `$(eye) Open ${t.issueId}`, action: 'open' as const },
        { label: '$(trash) Discard timer (no log)', action: 'discard' as const },
      ],
      { placeHolder: `YouTrack timer · ${formatDuration(Math.round((Date.now() - t.startedAt) / 1000))}` },
    );
    if (!pick) return;
    if (pick.action === 'stop') {
      await this.stop();
    } else if (pick.action === 'open') {
      vscode.commands.executeCommand('youtrack.openIssue', t.issueId);
    } else if (pick.action === 'discard') {
      await this.context.globalState.update(STATE_KEY, null);
      this.render();
      this.stopTick();
    }
  }

  private startTick(): void {
    if (this.tick) return;
    this.tick = setInterval(() => this.render(), 1000);
  }
  private stopTick(): void {
    if (!this.tick) return;
    clearInterval(this.tick);
    this.tick = undefined;
  }

  private render(): void {
    const t = this.activeTimer();
    if (!t) {
      this.item.hide();
      return;
    }
    const elapsed = Math.round((Date.now() - t.startedAt) / 1000);
    this.item.text = `$(watch) ${t.issueId} · ${formatDuration(elapsed)}`;
    this.item.tooltip = `YouTrack timer running on ${t.issueId}\nClick to stop / open / discard.`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.show();
  }

  dispose(): void {
    this.stopTick();
    this.item.dispose();
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
