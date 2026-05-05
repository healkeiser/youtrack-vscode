import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { runAgent } from './agent';
import { buildConventions } from './conventions';

// Fields the drafter may suggest. The user's CreateIssuePanel always
// makes the final call — these are pre-fill hints, not commitments.
export interface DraftIssueProposal {
  summary: string;
  description: string;
  suggestedProject?: string;       // shortName, e.g. "ABC"
  suggestedType?: string;          // enum value, e.g. "Bug"
  suggestedPriority?: string;      // enum value, e.g. "Major"
  suggestedTags?: string[];        // tag names
  similarIssues?: Array<{ idReadable: string; summary: string; reason?: string }>;
  /** Free-form rationale the agent surfaced — useful for telemetry/logs. */
  rationale?: string;
}

export interface DraftIssueDeps {
  client: YouTrackClient;
  cache: Cache;
  baseUrl: string;
  token: string;
}

export interface DraftIssueInput {
  /** Free-form description from the user. */
  freeText?: string;
  /** Code snippet context (for "from selection" flows). */
  selection?: {
    snippet: string;
    languageId: string;
    relPath: string;
    startLine: number;
    endLine: number;
  };
  /** Hints we already know (from settings, recent activity, etc.). */
  knownProjectShortName?: string;
  /**
   * If true, the agent uses the YouTrack MCP search tool to look for
   * near-duplicates; matches end up in `similarIssues`.
   */
  checkDuplicates?: boolean;
}

const SYSTEM_PROMPT = `You draft YouTrack issues for a developer.
You will receive raw context and must produce a single JSON object describing a well-written issue.

Constraints:
- Be specific, factual, and concise. No filler ("This issue is about...").
- Summary: imperative if it's a fix/task ("Crash on iOS 18 after passkey upgrade"), descriptive otherwise. Under 100 chars.
- Description: GitHub-flavored markdown. Use sections like "Steps to reproduce", "Expected", "Actual" only when the input warrants them. Skip sections that would be empty.
- Do NOT invent facts. If the input is sparse, the description can be sparse too.
- If the YouTrack MCP is available and you were asked to check duplicates, call its search/list-issues tool with the drafted summary as a query and surface real matches in similarIssues. Never invent issue ids.

Output ONLY a single JSON object inside a fenced code block tagged with "json". The object must conform to:

{
  "summary": string,
  "description": string,
  "suggestedProject"?: string,
  "suggestedType"?: string,
  "suggestedPriority"?: string,
  "suggestedTags"?: string[],
  "similarIssues"?: [ { "idReadable": string, "summary": string, "reason"?: string } ],
  "rationale"?: string
}

Do not include any prose outside the JSON block.`;

export async function draftIssue(deps: DraftIssueDeps, input: DraftIssueInput): Promise<DraftIssueProposal> {
  const userPrompt = buildPrompt(input);
  let raw = '';
  for await (const event of runAgent(userPrompt, {
    baseUrl: deps.baseUrl,
    token: deps.token,
    systemPrompt: `${SYSTEM_PROMPT}\n\n${buildConventions()}`,
    cache: deps.cache,
  })) {
    if (event.kind === 'text') raw += event.text;
    else if (event.kind === 'result' && event.text && !raw) raw = event.text;
    else if (event.kind === 'result' && event.error) {
      throw new Error(event.error);
    }
  }
  return parseProposal(raw);
}

function buildPrompt(input: DraftIssueInput): string {
  const lines: string[] = [];
  if (input.freeText?.trim()) {
    lines.push('## What the user wants to file', '', input.freeText.trim());
  }
  if (input.selection) {
    const s = input.selection;
    lines.push('', '## Code snippet they highlighted',
      `- File: \`${s.relPath}\``,
      `- Lines: ${s.startLine}${s.startLine === s.endLine ? '' : `–${s.endLine}`}`,
      `- Language: ${s.languageId || '(unknown)'}`,
      '',
      '```' + s.languageId,
      s.snippet,
      '```',
    );
  }
  if (input.knownProjectShortName) {
    lines.push('', `Project hint (from settings or workspace): \`${input.knownProjectShortName}\``);
  }
  if (input.checkDuplicates) {
    lines.push('',
      'Before responding, use the YouTrack MCP to search for similar existing issues using your drafted summary. ' +
      'Include any real matches (max 5) in `similarIssues` with a short reason each. ' +
      'Skip the search if no MCP search tool is available.',
    );
  }
  if (!lines.length) {
    lines.push('## Input', '', '_(empty — ask the model to draft from the conventions block alone, then ask the user for more.)_');
  }
  return lines.join('\n');
}

// Tolerant JSON extractor. The agent is asked for ONE fenced block, but
// we also handle the case where it returns bare JSON or a block tagged
// differently. Returns a normalized DraftIssueProposal — fields the
// agent omitted come back as undefined.
export function parseProposal(raw: string): DraftIssueProposal {
  const json = extractJson(raw);
  if (!json) {
    throw new Error('AI returned no JSON. Try again or rephrase.');
  }
  let obj: any;
  try { obj = JSON.parse(json); }
  catch (e) {
    throw new Error(`AI returned invalid JSON: ${(e as Error).message}`);
  }
  return normalize(obj);
}

function extractJson(raw: string): string | undefined {
  // Try ```json ... ``` first
  const fenced = raw.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n```/);
  if (fenced) return fenced[1].trim();
  // Fall back: first balanced { ... } block
  const start = raw.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === '\'') { inString = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return undefined;
}

function normalize(obj: any): DraftIssueProposal {
  const summary = String(obj.summary ?? '').trim();
  if (!summary) throw new Error('AI proposal missing required "summary" field.');
  const description = String(obj.description ?? '').trim();
  const proposal: DraftIssueProposal = { summary, description };
  if (typeof obj.suggestedProject === 'string') proposal.suggestedProject = obj.suggestedProject.trim();
  if (typeof obj.suggestedType === 'string') proposal.suggestedType = obj.suggestedType.trim();
  if (typeof obj.suggestedPriority === 'string') proposal.suggestedPriority = obj.suggestedPriority.trim();
  if (Array.isArray(obj.suggestedTags)) {
    proposal.suggestedTags = obj.suggestedTags.map((t: unknown) => String(t)).filter(Boolean);
  }
  if (Array.isArray(obj.similarIssues)) {
    proposal.similarIssues = obj.similarIssues
      .map((s: any) => ({
        idReadable: String(s?.idReadable ?? '').trim(),
        summary: String(s?.summary ?? '').trim(),
        reason: typeof s?.reason === 'string' ? s.reason.trim() : undefined,
      }))
      .filter((s: { idReadable: string }) => /^[A-Z][A-Z0-9_]+-\d+$/.test(s.idReadable));
  }
  if (typeof obj.rationale === 'string') proposal.rationale = obj.rationale.trim();
  return proposal;
}

// Convenience for callers that want a small progress wrapper. Centralizes
// the cancellable notification so the AI Create command and the panel's
// "Re-draft" button look the same to the user.
export async function draftWithProgress(
  deps: DraftIssueDeps,
  input: DraftIssueInput,
  title: string,
): Promise<DraftIssueProposal | undefined> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (_progress, ct) => {
      try {
        const proposalPromise = draftIssue(deps, input);
        const cancellation = new Promise<DraftIssueProposal>((_, rej) => {
          ct.onCancellationRequested(() => rej(new Error('Cancelled')));
        });
        return await Promise.race([proposalPromise, cancellation]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'Cancelled') {
          vscode.window.showErrorMessage(`YouTrack AI: ${msg}`);
        }
        return undefined;
      }
    },
  );
}
