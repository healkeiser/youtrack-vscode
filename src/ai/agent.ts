import * as vscode from 'vscode';
import * as cp from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Cache } from '../cache/cache';

// We used to depend on @anthropic-ai/claude-agent-sdk, which bundled the
// entire Claude Code binary as a per-platform optional dependency
// (~250MB on disk). That binary is the same `claude` the user already
// installed via Claude Code — we were shipping a redundant copy just to
// spawn a subprocess that talks to ~/.claude/. Instead we now spawn the
// user's own `claude` directly with its CLI flags. The .vsix is ~5MB,
// the build matrix collapses to a single universal artifact, and the
// Claude Code prerequisite stays the same (Max/Team plan, API key,
// Bedrock — whatever the user already authenticated against).

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

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
  permissionMode?: PermissionMode;
  /**
   * If provided, an internal PostToolUse hook will invalidate this
   * cache after any successful YouTrack MCP write tool — same wiring
   * the rest of the extension uses for manual mutations.
   */
  cache?: Cache;
}

// YouTrack hosts its MCP server alongside the REST API at /mcp. We swap
// the path while keeping protocol + host intact; trailing slashes on
// the configured baseUrl are tolerated.
export function deriveMcpUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.pathname = '/mcp';
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

interface AgentSettings {
  model: string;
  permissionMode: PermissionMode;
  maxTurns: number;
}

function readSettings(): AgentSettings {
  const cfg = vscode.workspace.getConfiguration('youtrack.ai');
  return {
    model: cfg.get<string>('model', 'claude-sonnet-4-6'),
    permissionMode: cfg.get<PermissionMode>('permissionMode', 'default'),
    maxTurns: cfg.get<number>('maxTurns', 12),
  };
}

// Public entry point. Spawns the user's `claude` CLI in --print mode
// with stream-json output, parses each line into an AgentEvent, and
// yields them. If `opts.cache` is provided, write tools that target
// the YouTrack MCP invalidate the cache so the rest of the extension's
// reactive UI catches up.
export async function* runAgent(
  prompt: string,
  opts: RunAgentOptions,
): AsyncGenerator<AgentEvent, void, void> {
  const settings = readSettings();
  const mcpConfigPath = writeMcpConfig(opts);

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'text',
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--permission-mode', opts.permissionMode ?? settings.permissionMode,
    '--max-turns', String(settings.maxTurns),
    '--model', opts.model ?? settings.model,
    '--verbose',
  ];
  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }

  const proc = spawnClaude(args);

  const wireAbort = (): void => {
    if (!opts.signal) return;
    if (opts.signal.aborted) { try { proc.kill(); } catch { /* ignore */ } return; }
    opts.signal.addEventListener('abort', () => { try { proc.kill(); } catch { /* ignore */ } }, { once: true });
  };
  wireAbort();

  // Send the user prompt via stdin so we don't have to escape it for
  // the shell. All other args are extension-controlled, so we can
  // treat them as safe.
  try {
    proc.stdin?.write(prompt);
    proc.stdin?.end();
  } catch {
    // Spawn failures (binary not found, permission denied) typically
    // surface here as an EPIPE on stdin.write. The error is also
    // emitted on the `error` event captured in waitForExit().
  }

  let buffered = '';
  let surfacedResult = false;
  const pendingTools = new Map<string, { name: string; input: unknown }>();
  const stderr: string[] = [];
  proc.stderr?.setEncoding('utf-8');
  proc.stderr?.on('data', (chunk: string) => stderr.push(chunk));

  try {
    for await (const message of readStreamJson(proc)) {
      const events = translate(message, pendingTools, opts.cache);
      for (const event of events) {
        if (event.kind === 'text') buffered += event.text;
        if (event.kind === 'result') surfacedResult = true;
        yield event;
      }
    }

    const exitCode = await waitForExit(proc);
    if (exitCode !== 0 && !surfacedResult) {
      const err = (stderr.join('').trim() || `claude exited with code ${exitCode}`).slice(0, 500);
      throw new Error(err);
    }

    if (!surfacedResult) {
      yield { kind: 'result', text: buffered };
    }
  } finally {
    try { fs.unlinkSync(mcpConfigPath); } catch { /* ignore */ }
  }
}

// Build the per-call MCP config blob and write it to a temp file.
// Claude Code's --mcp-config flag accepts a JSON file path; using a
// file (rather than passing JSON inline) avoids any shell-escaping
// quirks for the bearer token.
function writeMcpConfig(opts: RunAgentOptions): string {
  const mcpUrl = deriveMcpUrl(opts.baseUrl);
  const config = {
    mcpServers: {
      youtrack: {
        type: 'http',
        url: mcpUrl,
        headers: { Authorization: `Bearer ${opts.token}` },
      },
    },
  };
  const name = `youtrack-mcp-${crypto.randomBytes(6).toString('hex')}.json`;
  const file = path.join(os.tmpdir(), name);
  fs.writeFileSync(file, JSON.stringify(config), { encoding: 'utf-8', mode: 0o600 });
  return file;
}

// Cross-platform spawn that finds `claude` on PATH without relying on
// shell:true. On Windows the binary is shipped as `claude.cmd` (or
// `.ps1`); cmd.exe with /c handles the .cmd dispatch correctly. On
// Unix-likes we hit `claude` directly.
function spawnClaude(args: string[]): cp.ChildProcess {
  const stdio: cp.StdioOptions = ['pipe', 'pipe', 'pipe'];
  if (process.platform === 'win32') {
    return cp.spawn('cmd.exe', ['/c', 'claude', ...args], { stdio });
  }
  return cp.spawn('claude', args, { stdio });
}

interface StreamMessage {
  type: string;
  [key: string]: unknown;
}

// Read stdout line-by-line. Claude Code's stream-json format emits
// one JSON object per line; we split on \n and drop blank/garbage
// lines. Buffering survives chunks that don't end on a newline.
async function* readStreamJson(proc: cp.ChildProcess): AsyncGenerator<StreamMessage, void, void> {
  if (!proc.stdout) return;
  proc.stdout.setEncoding('utf-8');
  let buf = '';
  for await (const chunk of proc.stdout as AsyncIterable<string>) {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { yield JSON.parse(line) as StreamMessage; }
      catch { /* malformed line — skip; preserves stream resilience */ }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try { yield JSON.parse(tail) as StreamMessage; }
    catch { /* ignore */ }
  }
}

function waitForExit(proc: cp.ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    proc.once('exit', (code) => resolve(code ?? -1));
    proc.once('error', (e) => reject(e));
  });
}

// Translate one stream-json message into zero or more AgentEvents.
// Tracks tool_use ids so we can fire cache invalidation after a
// matching tool_result (PostToolUse semantics — only invalidate on
// success). Mirror of the SDK-side translate() that lived here before.
function translate(
  msg: StreamMessage,
  pendingTools: Map<string, { name: string; input: unknown }>,
  cache: Cache | undefined,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  if (msg.type === 'assistant') {
    const message = msg.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return events;
    let text = '';
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
      if (block.type === 'tool_use') {
        const id = String(block.id ?? '');
        const name = String(block.name ?? '');
        const input = block.input;
        if (id) pendingTools.set(id, { name, input });
        events.push({ kind: 'tool', name, input });
      }
    }
    if (text) events.push({ kind: 'text', text });
    return events;
  }

  if (msg.type === 'user') {
    // Claude Code echoes tool_result blocks back as synthetic user
    // messages. We use them to trigger PostToolUse invalidation.
    const message = msg.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content) || !cache) return events;
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type !== 'tool_result') continue;
      const id = String(block.tool_use_id ?? '');
      const isError = !!block.is_error;
      if (isError) { pendingTools.delete(id); continue; }
      const meta = pendingTools.get(id);
      pendingTools.delete(id);
      if (meta) invalidateForTool(cache, meta.name, meta.input, block.content);
    }
    return events;
  }

  if (msg.type === 'result') {
    const r = msg as unknown as {
      result?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      is_error?: boolean;
      subtype?: string;
    };
    events.push({
      kind: 'result',
      text: r.result ?? '',
      durationMs: r.duration_ms,
      costUsd: r.total_cost_usd,
      error: r.is_error ? (r.subtype ?? 'agent error') : undefined,
    });
  }

  return events;
}

// Permissive heuristic: any tool that came from the YouTrack MCP and
// doesn't look like a read invalidates whatever issue ids we can find
// in the input or output. False positives just trigger a refetch;
// missed mutations leave the sidebar stale.
const ISSUE_ID_RE = /\b[A-Z][A-Z0-9_]+-\d{1,7}\b/g;
const READ_HINTS = /^(get|list|search|fetch|read|find|describe|show)/i;

function invalidateForTool(cache: Cache, name: string, input: unknown, output: unknown): void {
  const isYouTrackMcp = name.startsWith('mcp__youtrack__') || name.startsWith('mcp__youtrack-');
  if (!isYouTrackMcp) return;
  const bareName = name.replace(/^mcp__[^_]+__/, '');
  if (READ_HINTS.test(bareName)) return;

  const ids = collectIssueIds(input, output);
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
