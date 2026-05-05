import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import type { Issue, Comment, CustomField } from '../client/types';
import { runAgent } from './agent';
import { buildConventions } from './conventions';
import { showYouTrackError } from '../client/errors';

export interface SummarizeDeps {
  client: YouTrackClient;
  cache: Cache;
  baseUrl: string;
  token: string;
}

const SYSTEM_PROMPT = `You are a precise software-engineering assistant helping a developer understand a YouTrack issue quickly.
You have access to the YouTrack MCP server if you need extra context (related issues, history, etc.) but for most issues the message contains everything you need.
Respond in concise GitHub-flavored markdown with these sections:

## TL;DR
One or two sentences. What is this and what does success look like.

## Context
What we know about the problem. Cite specific commenters when their input matters; skip pleasantries.

## Open questions
Bullet list. Empty if none.

## Suggested next steps
Bullet list of 1–4 concrete actions for the developer who picks this up.

Do not invent facts. If the issue is sparse, say so explicitly.`;

export async function summarizeIssue(deps: SummarizeDeps, issueId: string): Promise<void> {
  let issue: Issue;
  let comments: Comment[];
  try {
    [issue, comments] = await Promise.all([
      deps.cache.getIssue(issueId, (id) => deps.client.fetchIssue(id)),
      deps.client.fetchComments(issueId).catch(() => [] as Comment[]),
    ]);
  } catch (e) {
    showYouTrackError(e, 'load issue for AI summary');
    return;
  }

  const userPrompt = buildPrompt(issue, comments);
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# AI summary — ${issue.idReadable}\n\n_Generating…_\n`,
  });
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: false,
    preserveFocus: true,
  });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Summarizing ${issue.idReadable}…`, cancellable: true },
    async (progress, ct) => {
      const ctl = new AbortController();
      ct.onCancellationRequested(() => ctl.abort());

      let buffered = `# AI summary — ${issue.idReadable}\n\n`;
      let needsHeaderReplace = true;

      try {
        for await (const event of runAgent(userPrompt, {
          baseUrl: deps.baseUrl,
          token: deps.token,
          systemPrompt: `${SYSTEM_PROMPT}\n\n${buildConventions()}`,
          signal: ctl.signal,
          cache: deps.cache,
        })) {
          if (event.kind === 'text') {
            buffered += event.text;
            await replaceAll(editor, buffered);
          } else if (event.kind === 'tool') {
            progress.report({ message: `${event.name}…` });
          } else if (event.kind === 'result') {
            if (event.error) {
              buffered += `\n\n> _Agent error: ${event.error}_\n`;
              await replaceAll(editor, buffered);
            } else if (!buffered.includes(event.text) && event.text) {
              buffered = `# AI summary — ${issue.idReadable}\n\n${event.text}`;
              await replaceAll(editor, buffered);
            }
            needsHeaderReplace = false;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        buffered += `\n\n> _Agent failed: ${msg}_\n`;
        await replaceAll(editor, buffered);
      }

      if (needsHeaderReplace && buffered.endsWith('_Generating…_\n')) {
        await replaceAll(editor, `# AI summary — ${issue.idReadable}\n\n_(no output)_\n`);
      }
    },
  );
}

async function replaceAll(editor: vscode.TextEditor, text: string): Promise<void> {
  const doc = editor.document;
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length),
  );
  await editor.edit(
    (b) => b.replace(fullRange, text),
    { undoStopBefore: false, undoStopAfter: false },
  );
}

function buildPrompt(issue: Issue, comments: Comment[]): string {
  const fields = formatFields(issue.customFields);
  const links = issue.links
    .flatMap((l) => l.issues.map((i) => `- ${l.name}: ${i.idReadable} — ${i.summary}`))
    .join('\n');
  const commentBlock = comments.length
    ? comments
        .slice(-30)
        .map((c) => `### ${c.author.fullName || c.author.login} — ${new Date(c.created).toISOString().slice(0, 10)}\n${c.text}`)
        .join('\n\n')
    : '_(no comments)_';

  return [
    `Summarize the YouTrack issue **${issue.idReadable}**.`,
    '',
    `**Title:** ${issue.summary}`,
    `**Project:** ${issue.project.shortName}`,
    `**Reporter:** ${issue.reporter?.fullName ?? issue.reporter?.login ?? 'unknown'}`,
    `**Assignee:** ${issue.assignee?.fullName ?? issue.assignee?.login ?? 'unassigned'}`,
    fields ? `**Fields:**\n${fields}` : '',
    issue.tags.length ? `**Tags:** ${issue.tags.map((t) => t.name).join(', ')}` : '',
    links ? `**Links:**\n${links}` : '',
    '',
    '## Description',
    issue.description?.trim() || '_(no description)_',
    '',
    '## Comments',
    commentBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatFields(fields: CustomField[]): string {
  const interesting = fields.filter((f) => f.value.kind !== 'empty');
  if (!interesting.length) return '';
  return interesting
    .map((f) => {
      const v = f.value;
      const text = (() => {
        switch (v.kind) {
          case 'enum':    return v.name;
          case 'state':   return v.name;
          case 'user':    return v.fullName || v.login;
          case 'string':  return v.text;
          case 'date':    return v.iso;
          case 'period':  return `${v.seconds}s`;
          case 'number':  return String(v.value);
          case 'bool':    return v.value ? 'yes' : 'no';
          case 'version': return v.name;
          case 'unknown': return v.raw;
          default:        return '';
        }
      })();
      return `- ${f.name}: ${text}`;
    })
    .join('\n');
}
