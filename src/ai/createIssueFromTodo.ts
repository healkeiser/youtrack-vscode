import * as vscode from 'vscode';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Cache } from '../cache/cache';
import { CreateIssuePanel, type CreateIssueAiDeps } from '../ui/createIssuePanel';
import { draftWithProgress, type DraftIssueInput } from './draftIssue';
import type { TodoCommandPayload } from '../ui/todoCodeActionProvider';

export interface TodoIssueDeps {
  client: YouTrackClient;
  cache: Cache;
  baseUrl: string;
  token: string;
  extensionUri: vscode.Uri;
  context: vscode.ExtensionContext;
  buildAiDeps: () => CreateIssueAiDeps | undefined;
}

const CONTEXT_LINES_BEFORE = 8;
const CONTEXT_LINES_AFTER = 12;

// Quick-fix entrypoint. Reads the surrounding code so the agent has
// real context, drafts a proposal, opens CreateIssuePanel pre-filled.
// On successful submit, rewrites the original TODO line to include the
// new issue id (e.g. `# TODO` → `# TODO PIPE-633`) using a workspace
// edit. Replacement is gated by youtrack.ai.codeActions.replaceTodoWithIssueId.
export async function createIssueFromTodo(deps: TodoIssueDeps, payload: TodoCommandPayload): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(payload.uri);
  const surrounding = collectSurrounding(doc, payload.lineRange);

  const input: DraftIssueInput = {
    freeText: payload.text || `${payload.marker} comment in ${vscode.workspace.asRelativePath(payload.uri, false)}`,
    selection: {
      snippet: surrounding.snippet,
      languageId: doc.languageId || '',
      relPath: vscode.workspace.asRelativePath(payload.uri, false),
      startLine: surrounding.startLine,
      endLine: surrounding.endLine,
    },
    knownProjectShortName: vscode.workspace.getConfiguration('youtrack').get<string>('defaultProject') || undefined,
    checkDuplicates: vscode.workspace.getConfiguration('youtrack.ai.draft').get<boolean>('checkDuplicates', true),
  };

  const proposal = await draftWithProgress(
    { client: deps.client, cache: deps.cache, baseUrl: deps.baseUrl, token: deps.token },
    input,
    `Drafting issue from ${payload.marker}…`,
  );
  if (!proposal) return;

  CreateIssuePanel.show(
    deps.extensionUri, deps.client, deps.context,
    async (idReadable) => {
      deps.cache.notifyCreated(idReadable);
      await maybeStampTodo(payload, idReadable);
    },
    {
      summary: proposal.summary,
      description: proposal.description,
      ai: {
        suggestedProject: proposal.suggestedProject,
        suggestedType: proposal.suggestedType,
        suggestedPriority: proposal.suggestedPriority,
        suggestedTags: proposal.suggestedTags,
        similarIssues: proposal.similarIssues,
      },
    },
    deps.buildAiDeps(),
  );
}

interface Surrounding {
  snippet: string;
  startLine: number;
  endLine: number;
}

function collectSurrounding(doc: vscode.TextDocument, lineRange: vscode.Range): Surrounding {
  const todoLine = lineRange.start.line;
  const startLine = Math.max(0, todoLine - CONTEXT_LINES_BEFORE);
  const endLine = Math.min(doc.lineCount - 1, todoLine + CONTEXT_LINES_AFTER);
  const lines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    lines.push(doc.lineAt(i).text);
  }
  return {
    snippet: lines.join('\n'),
    startLine: startLine + 1,
    endLine: endLine + 1,
  };
}

async function maybeStampTodo(payload: TodoCommandPayload, idReadable: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('youtrack.ai.codeActions');
  if (!cfg.get<boolean>('replaceTodoWithIssueId', true)) return;

  // Default format: "TODO" → "TODO ABC-123". Format string supports
  // {marker} and {id}; a leading $ keeps the conversion tight when the
  // user wants e.g. "TODO(ABC-123)".
  const format = cfg.get<string>('todoIdFormat', '{marker} {id}');
  const replacement = format
    .replace(/\{marker\}/g, payload.marker)
    .replace(/\{id\}/g, idReadable);

  // Re-resolve the line in case the user edited the file in the
  // meantime — we'd rather not blindly trust the original payload's
  // ranges. We search the line for the marker word; if it's not there
  // anymore, give up silently rather than corrupting unrelated text.
  let doc: vscode.TextDocument;
  try { doc = await vscode.workspace.openTextDocument(payload.uri); }
  catch { return; }

  const line = doc.lineAt(Math.min(payload.lineRange.start.line, doc.lineCount - 1));
  const re = new RegExp(`\\b${escapeRegex(payload.marker)}\\b`);
  const m = re.exec(line.text);
  if (!m) return;

  // Avoid double-stamping if the line already has any issue id.
  if (/\b[A-Z][A-Z0-9_]+-\d+\b/.test(line.text)) return;

  const startCol = m.index;
  const endCol = startCol + m[0].length;
  const wsEdit = new vscode.WorkspaceEdit();
  wsEdit.replace(
    payload.uri,
    new vscode.Range(line.lineNumber, startCol, line.lineNumber, endCol),
    replacement,
  );
  await vscode.workspace.applyEdit(wsEdit);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
