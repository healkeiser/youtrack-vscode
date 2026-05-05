import * as vscode from 'vscode';
import type { Cache } from '../cache/cache';
// Type-only — keeps the bundle CJS-friendly. The SDK itself is ESM-only,
// so we load it via dynamic import() inside runAgent().
import type { SDKMessage, Options, PostToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';

export interface AgentTextChunk {
  kind: 'text';
  text: string;
}

export interface AgentToolUse {
  kind: 'tool';
  name: string;
  input: unknown;
}

export interface AgentResult {
  kind: 'result';
  text: string;
  durationMs?: number;
  /** Optional cost field if the SDK reports it. */
  costUsd?: number;
  error?: string;
}

export type AgentEvent = AgentTextChunk | AgentToolUse | AgentResult;

export interface RunAgentOptions {
  /** YouTrack base URL — used to derive the MCP endpoint <host>/mcp. */
  baseUrl: string;
  /** YouTrack permanent token / OAuth token — passed as Bearer to the MCP. */
  token: string;
  /** Cancellation. */
  signal?: AbortSignal;
  /** System prompt prepended to the user prompt. */
  systemPrompt?: string;
  /** Override the default model (settings) for this call. */
  model?: string;
  /** Override the default permission mode (settings) for this call. */
  permissionMode?: Options['permissionMode'];
  /**
   * If provided, the agent's tool-use hook will invalidate this cache
   * after any YouTrack MCP write tool succeeds — so the sidebar trees
   * and any open detail/board panels auto-refresh, the same way they
   * do for manual mutations.
   */
  cache?: Cache;
}

// Convert a YouTrack base URL to its MCP endpoint. YouTrack hosts the MCP
// server alongside the REST API at /mcp, so we just swap the path while
// keeping the protocol + host intact. Trailing slashes are tolerated.
export function deriveMcpUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.pathname = '/mcp';
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

function readSettings(): { model: string; permissionMode: Options['permissionMode']; maxTurns: number } {
  const cfg = vscode.workspace.getConfiguration('youtrack.ai');
  return {
    model: cfg.get<string>('model', 'claude-sonnet-4-6'),
    permissionMode: cfg.get<Options['permissionMode']>('permissionMode', 'default'),
    maxTurns: cfg.get<number>('maxTurns', 12),
  };
}

// Streams events from a single agent run. The caller provides the user
// prompt and a YouTrack-derived MCP config; we hand it to the Claude
// Agent SDK, which inherits Claude Code's local auth (Max plan, Team
// plan, API key, Bedrock — whatever the user already has wired up).
//
// Tool calls against the YouTrack MCP and the agent's text output are
// emitted as discrete events so callers can render them however they
// like (chat panel, status bar, untitled markdown buffer, …).
export async function* runAgent(
  prompt: string,
  opts: RunAgentOptions,
): AsyncGenerator<AgentEvent, void, void> {
  const settings = readSettings();
  const mcpUrl = deriveMcpUrl(opts.baseUrl);

  const sdkOptions: Options = {
    model: opts.model ?? settings.model,
    permissionMode: opts.permissionMode ?? settings.permissionMode,
    maxTurns: settings.maxTurns,
    systemPrompt: opts.systemPrompt,
    mcpServers: {
      youtrack: {
        type: 'http',
        url: mcpUrl,
        headers: { Authorization: `Bearer ${opts.token}` },
      },
    },
    abortController: opts.signal ? abortToController(opts.signal) : undefined,
    hooks: opts.cache
      ? {
          PostToolUse: [
            {
              hooks: [
                async (input) => {
                  if (input.hook_event_name !== 'PostToolUse') return { continue: true };
                  invalidateForTool(opts.cache!, input);
                  return { continue: true };
                },
              ],
            },
          ],
        }
      : undefined,
  };

  let buffered = '';
  let result: AgentResult | undefined;

  const { query } = await loadSdk();
  for await (const message of query({ prompt, options: sdkOptions })) {
    const event = translate(message);
    if (!event) continue;
    if (event.kind === 'text') buffered += event.text;
    if (event.kind === 'result') {
      result = { ...event, text: event.text || buffered };
    }
    yield event;
  }

  if (!result) {
    yield { kind: 'result', text: buffered };
  }
}

function translate(message: SDKMessage): AgentEvent | undefined {
  if (message.type === 'assistant') {
    const content = message.message?.content;
    if (!Array.isArray(content)) return undefined;
    let text = '';
    for (const block of content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') {
        return { kind: 'tool', name: block.name, input: block.input };
      }
    }
    if (text) return { kind: 'text', text };
    return undefined;
  }
  if (message.type === 'result') {
    const r = message as unknown as { result?: string; total_cost_usd?: number; duration_ms?: number; is_error?: boolean; subtype?: string };
    return {
      kind: 'result',
      text: r.result ?? '',
      durationMs: r.duration_ms,
      costUsd: r.total_cost_usd,
      error: r.is_error ? (r.subtype ?? 'agent error') : undefined,
    };
  }
  return undefined;
}

// Treat any tool that came from the YouTrack MCP and looks mutating as a
// reason to invalidate the cache. We're permissive — false positives just
// trigger a background refetch, while a missed mutation leaves the
// sidebar stale until the user clicks refresh. We extract any issue-id-
// shaped string from the input/output and invalidate that specific id;
// if we can't find one we emit a "created" notification, which still
// flows through to refresh subscribers.
const ISSUE_ID_RE = /\b[A-Z][A-Z0-9_]+-\d{1,7}\b/g;
const READ_HINTS = /^(get|list|search|fetch|read|find|describe|show)/i;

function invalidateForTool(cache: Cache, input: PostToolUseHookInput): void {
  const name = input.tool_name ?? '';
  const isYouTrackMcp = name.startsWith('mcp__youtrack__') || name.startsWith('mcp__youtrack-');
  if (!isYouTrackMcp) return;
  const bareName = name.replace(/^mcp__[^_]+__/, '');
  if (READ_HINTS.test(bareName)) return;

  const ids = collectIssueIds(input.tool_input, input.tool_response);
  if (ids.size === 0) {
    cache.notifyCreated();
    return;
  }
  for (const id of ids) cache.invalidateIssue(id);
}

function collectIssueIds(...values: unknown[]): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === 'string') {
      const m = v.match(ISSUE_ID_RE);
      if (m) for (const x of m) out.add(x);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    if (typeof v === 'object') { for (const x of Object.values(v as Record<string, unknown>)) visit(x); }
  };
  for (const v of values) visit(v);
  return out;
}

function abortToController(signal: AbortSignal): AbortController {
  const ctl = new AbortController();
  if (signal.aborted) ctl.abort();
  else signal.addEventListener('abort', () => ctl.abort(), { once: true });
  return ctl;
}

// The SDK is ESM-only but the extension bundles as CJS, so we load it
// lazily through dynamic import. esbuild leaves dynamic imports of
// external modules alone, so this resolves at runtime against the
// node_modules tree shipped inside the .vsix.
//
// We also catch and rethrow with a friendlier message so users without
// Claude Code installed get an actionable error instead of a stack trace.
let sdkPromise: Promise<typeof import('@anthropic-ai/claude-agent-sdk')> | null = null;
async function loadSdk(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  if (!sdkPromise) {
    sdkPromise = import('@anthropic-ai/claude-agent-sdk').catch((e) => {
      sdkPromise = null;
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not load the Claude Agent SDK (${msg}). Install Claude Code from https://claude.com/claude-code and reload VS Code.`,
      );
    });
  }
  return sdkPromise;
}
