import * as vscode from 'vscode';
import { joinUrl, type YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { Issue } from '../client/types';
import { showYouTrackError } from '../client/errors';
import { buildConventions } from './conventions';

export interface DiscussDeps {
  client: YouTrackClient;
  cache: Cache;
  baseUrl: string;
}

interface PromptPreset {
  label: string;
  description: string;
  build: (issueRef: string) => string;
}

const PRESETS: PromptPreset[] = [
  {
    label: '$(comment-discussion) Free-form question',
    description: 'Type your own prompt',
    build: () => '',
  },
  {
    label: '$(book) Explain this issue',
    description: 'Walkthrough + context',
    build: (ref) => `Walk me through ${ref}. Highlight the goal, the constraints, anything ambiguous, and what would need to happen for this to be done.`,
  },
  {
    label: '$(tools) Plan the fix',
    description: 'Suggest an approach + branch name',
    build: (ref) => `Plan how to fix ${ref}. Propose a branch name that follows the studio conventions above, list the files I should look at, and outline the implementation steps before any coding.`,
  },
  {
    label: '$(git-commit) Draft a commit message',
    description: 'Conventional message with the right prefix',
    build: (ref) => `Draft a commit message for ${ref} following the studio commit-prefix convention above. Keep it under 70 chars on the subject line. Use my staged changes as the basis.`,
  },
  {
    label: '$(comment) Draft a comment to post on the ticket',
    description: 'Status update aimed at stakeholders',
    build: (ref) => `Draft a YouTrack comment to post on ${ref} summarizing the current status. Tone: factual, concise, no fluff. Mention blockers if any.`,
  },
];

export async function discussInTerminal(deps: DiscussDeps, issueId: string): Promise<void> {
  let issue: Issue;
  try {
    issue = await deps.cache.getIssue(issueId, (id) => deps.client.fetchIssue(id));
  } catch (e) {
    showYouTrackError(e, 'load issue for AI discussion');
    return;
  }

  const preset = await vscode.window.showQuickPick(
    PRESETS.map((p) => ({ label: p.label, description: p.description, preset: p })),
    { title: `Discuss ${issue.idReadable} with Claude Code`, placeHolder: 'Pick a starting prompt' },
  );
  if (!preset) return;

  let userPrompt = preset.preset.build(issue.idReadable);
  if (!userPrompt) {
    userPrompt = (await vscode.window.showInputBox({
      title: `Ask Claude about ${issue.idReadable}`,
      prompt: 'Your question (the issue context will be prepended automatically)',
      ignoreFocusOut: true,
    })) ?? '';
    if (!userPrompt.trim()) return;
  }

  const url = issueUrl(deps.baseUrl, issue.idReadable);
  const message = [
    buildConventions(),
    '## Issue context',
    '',
    `- **${issue.idReadable}** — ${issue.summary}`,
    `- Project: ${issue.project.shortName}`,
    `- State: ${stateName(issue) || 'unknown'}`,
    `- Assignee: ${issue.assignee?.fullName ?? issue.assignee?.login ?? 'unassigned'}`,
    `- URL: ${url}`,
    '',
    issue.description?.trim()
      ? `### Description\n${issue.description.trim()}\n`
      : '',
    '## My question',
    '',
    userPrompt,
  ]
    .filter(Boolean)
    .join('\n');

  const terminal = await findOrStartClaudeTerminal();
  if (!terminal) return;
  terminal.show(/* preserveFocus */ false);
  await pasteIntoTerminal(terminal, message);
}

// VS Code's terminal.sendText() is unreliable for payloads larger than
// ~700 chars on Windows ConPTY (microsoft/vscode#292058) — the write
// can be truncated or partially stranded in the pty input buffer, and
// on Claude Code exit the residue flushes to the host shell, which
// then tries to execute lines like "- **Branch template:** ..." as
// commands. Our prompt body is well over that threshold.
//
// Route through the OS clipboard and trigger VS Code's native
// terminal-paste command instead. That produces a single atomic paste
// event that respects bracketed-paste mode automatically (Claude Code
// has paste mode enabled, so the body lands as one paste, not as
// keystrokes), and it doesn't add a trailing newline, so the prompt
// is staged for the user to review and submit themselves.
async function pasteIntoTerminal(terminal: vscode.Terminal, body: string): Promise<void> {
  terminal.show(false);
  let previousClip = '';
  try {
    previousClip = await vscode.env.clipboard.readText();
  } catch {
    // Clipboard read can fail on locked sessions; proceed without restore.
  }
  await vscode.env.clipboard.writeText(body);
  await vscode.commands.executeCommand('workbench.action.terminal.paste');
  // Restore the user's clipboard once the paste has been drained from
  // it. 250 ms is comfortably longer than the paste round-trip.
  setTimeout(() => {
    void vscode.env.clipboard.writeText(previousClip);
  }, 250);
}

// Strategy:
//   1. If a terminal whose name contains "Claude" is already open, use it.
//   2. Otherwise, ask the user whether to start one. We can't reliably
//      auto-start `claude` across shells (PowerShell vs. bash vs. zsh,
//      different installation paths), and silently spawning a terminal
//      where the user has to wait for Claude to load before our pasted
//      prompt makes sense is a worse UX than telling them.
async function findOrStartClaudeTerminal(): Promise<vscode.Terminal | undefined> {
  const existing = vscode.window.terminals.find((t) => /claude/i.test(t.name));
  if (existing) return existing;

  const choice = await vscode.window.showInformationMessage(
    'No Claude Code terminal is open. Start one?',
    'Start in new terminal',
    'Cancel',
  );
  if (choice !== 'Start in new terminal') return undefined;

  const terminal = vscode.window.createTerminal({ name: 'Claude' });
  terminal.show(false);
  terminal.sendText('claude');
  // Give the CLI a moment to print its banner before we paste a long
  // prompt into it — paste-on-empty-line is what Claude Code expects,
  // and pasting into a half-initialized terminal sometimes drops chars.
  await new Promise((r) => setTimeout(r, 1500));
  return terminal;
}

function stateName(issue: Issue): string {
  const f = issue.customFields.find((cf) => cf.name === 'State');
  if (!f) return '';
  if (f.value.kind === 'state' || f.value.kind === 'enum') return f.value.name;
  return '';
}

function issueUrl(baseUrl: string, idReadable: string): string {
  return joinUrl(baseUrl, `/issue/${idReadable}`);
}
