import * as vscode from 'vscode';
import type { Cache } from '../cache/cache';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Issue } from '../client/types';
import type { SidebarState } from './sidebarState';

type Node =
  | { kind: 'project'; shortName: string; issues: Issue[] }
  | { kind: 'issue'; issue: Issue }
  | { kind: 'loadMore' };

const PAGE_SIZE = 50;

export interface QuerySource {
  /** Human-readable — used in error messages. */
  label: string;
  /** Free YouTrack query string. Used if savedQueryName does not resolve. */
  directQuery?: string;
  /** Name of a YouTrack saved query. If resolved, takes precedence over directQuery. */
  savedQueryName?: string;
}

interface StateVisuals { icon: string; color?: string }

function issueStateName(issue: Issue): string {
  const field = issue.customFields.find((f) => f.name === 'State');
  if (!field) return '';
  const v = field.value;
  if (v.kind === 'state' || v.kind === 'enum') return v.name;
  return '';
}

function stateVisuals(state: string): StateVisuals {
  const s = state.toLowerCase();
  if (!s) return { icon: 'circle-outline' };
  if (/(done|fixed|closed|resolved|verified|complete)/.test(s)) return { icon: 'pass-filled', color: 'testing.iconPassed' };
  if (/(progress|develop|working|wip|active)/.test(s)) return { icon: 'sync', color: 'charts.blue' };
  if (/(review|pending|waiting|qa|test)/.test(s)) return { icon: 'eye', color: 'charts.yellow' };
  if (/(cancel|reject|won|invalid|duplicate|obsolete)/.test(s)) return { icon: 'circle-slash', color: 'charts.red' };
  if (/(block|hold|paused)/.test(s)) return { icon: 'debug-pause', color: 'charts.orange' };
  if (/(submit|open|reopen|new|backlog|todo|to do)/.test(s)) return { icon: 'circle-outline' };
  return { icon: 'circle-outline' };
}

function tagColorEmoji(bg: string | undefined | null): string {
  if (!bg) return '⚪';
  const m = /#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(bg);
  if (!m) return '⚪';
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;
  if (lightness < 0.18) return '⚫';
  if (lightness > 0.90 && max - min < 25) return '⚪';
  const d = max - min;
  if (d < 15) return '⚪';
  let h: number;
  if (max === r) h = ((g - b) / d);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  if (h < 20 || h >= 340) return '🔴';
  if (h < 50)  return '🟠';
  if (h < 75)  return '🟡';
  if (h < 170) return '🟢';
  if (h < 260) return '🔵';
  return '🟣';
}

export class QueryTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<Node | undefined>();
  onDidChangeTreeData = this._emitter.event;

  private loaded: Issue[] = [];
  private hasMore = true;
  private skip = 0;
  private resolvedSavedQueryId: string | undefined;
  private pending: Promise<void> | null = null;

  constructor(
    public readonly viewId: string,
    private client: YouTrackClient,
    private cache: Cache,
    private state: SidebarState,
    private source: QuerySource,
  ) {
    state.onDidChange(() => this._emitter.fire(undefined));
  }

  refresh(): void {
    this.loaded = [];
    this.hasMore = true;
    this.skip = 0;
    this.resolvedSavedQueryId = undefined;
    this.pending = null;
    this._emitter.fire(undefined);
  }

  private matches(issue: Issue): boolean {
    const { filterText, stateFilter, tagFilter } = this.state;
    if (filterText) {
      const hay = `${issue.idReadable} ${issue.summary} ${issue.assignee?.login ?? ''} ${issue.assignee?.fullName ?? ''} ${issue.project.shortName}`.toLowerCase();
      if (!hay.includes(filterText)) return false;
    }
    if (stateFilter.size > 0) {
      if (!stateFilter.has(issueStateName(issue))) return false;
    }
    if (tagFilter.size > 0) {
      if (!issue.tags.some((t) => tagFilter.has(t.name))) return false;
    }
    return true;
  }

  private sort(issues: Issue[]): Issue[] {
    const mode = this.state.sortMode;
    if (mode === 'default') return issues;
    const sorted = [...issues];
    if (mode === 'updated') sorted.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    else if (mode === 'created') sorted.sort((a, b) => (b.created || 0) - (a.created || 0));
    else if (mode === 'id') sorted.sort((a, b) => a.idReadable.localeCompare(b.idReadable, undefined, { numeric: true }));
    return sorted;
  }

  private async ensureFirstPage(): Promise<void> {
    if (this.loaded.length > 0 || !this.hasMore) return;
    if (this.pending) { await this.pending; return; }
    this.pending = (async () => {
      try {
        // Try to resolve a saved query by name if requested
        if (this.source.savedQueryName && this.resolvedSavedQueryId === undefined) {
          const saved = await this.cache.getSavedQueries(() => this.client.fetchSavedQueries());
          const target = this.source.savedQueryName.toLowerCase();
          const hit = saved.find((q) => q.name.toLowerCase() === target);
          if (hit) this.resolvedSavedQueryId = hit.id;
        }
        const first = this.resolvedSavedQueryId
          ? await this.client.searchSavedQueryIssues(this.resolvedSavedQueryId, 0, PAGE_SIZE)
          : await this.client.searchIssues(this.source.directQuery ?? '', 0, PAGE_SIZE);
        this.loaded = first;
        this.skip = first.length;
        this.hasMore = first.length === PAGE_SIZE;
        for (const i of first) this.cache.putIssue(i);
      } finally {
        this.pending = null;
      }
    })();
    await this.pending;
  }

  getAllLoaded(): Issue[] {
    return this.loaded;
  }

  async loadMore(): Promise<void> {
    const more = this.resolvedSavedQueryId
      ? await this.client.searchSavedQueryIssues(this.resolvedSavedQueryId, this.skip, PAGE_SIZE)
      : await this.client.searchIssues(this.source.directQuery ?? '', this.skip, PAGE_SIZE);
    this.loaded = this.loaded.concat(more);
    this.skip += more.length;
    this.hasMore = more.length === PAGE_SIZE;
    for (const i of more) this.cache.putIssue(i);
    this._emitter.fire(undefined);
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      await this.ensureFirstPage();
      const visible = this.sort(this.loaded.filter((i) => this.matches(i)));

      const loadMoreNode: Node[] = this.hasMore && !this.state.anyFilterActive()
        ? [{ kind: 'loadMore' }]
        : [];

      if (this.state.groupMode === 'project') {
        const byProject = new Map<string, Issue[]>();
        for (const issue of visible) {
          const key = issue.project.shortName || '—';
          const arr = byProject.get(key);
          if (arr) arr.push(issue);
          else byProject.set(key, [issue]);
        }
        const sorted = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b));
        return [
          ...sorted.map(([shortName, issues]) => ({ kind: 'project' as const, shortName, issues })),
          ...loadMoreNode,
        ];
      }

      return [...visible.map((i) => ({ kind: 'issue' as const, issue: i })), ...loadMoreNode];
    }

    if (element.kind === 'project') {
      return element.issues.map((i) => ({ kind: 'issue', issue: i }));
    }

    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'project') {
      const t = new vscode.TreeItem(node.shortName, vscode.TreeItemCollapsibleState.Expanded);
      t.iconPath = new vscode.ThemeIcon('folder');
      t.description = String(node.issues.length);
      t.contextValue = 'project';
      return t;
    }
    if (node.kind === 'issue') {
      const state = issueStateName(node.issue);
      const { icon, color } = stateVisuals(state);
      const t = new vscode.TreeItem(
        `${node.issue.idReadable}  ${node.issue.summary}`,
        vscode.TreeItemCollapsibleState.None,
      );
      t.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
      const descParts: string[] = [];
      if (state) descParts.push(state);
      if (node.issue.tags.length) {
        descParts.push(node.issue.tags.map((tag) => `${tagColorEmoji(tag.color?.background)} ${tag.name}`).join('  '));
      }
      t.description = descParts.length ? descParts.join('  ·  ') : undefined;
      t.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [node.issue.idReadable] };
      t.contextValue = 'issue';
      const tooltip = new vscode.MarkdownString();
      tooltip.supportThemeIcons = true;
      if (state) tooltip.appendMarkdown(`**${state}**  \n`);
      tooltip.appendMarkdown(`${node.issue.summary}\n`);
      if (node.issue.tags.length) {
        const parts = node.issue.tags.map((tag) => `${tagColorEmoji(tag.color?.background)} \`${tag.name}\``);
        tooltip.appendMarkdown(`\n\n_Tags:_ ${parts.join(' ')}`);
      }
      t.tooltip = tooltip;
      return t;
    }
    const t = new vscode.TreeItem('Load more...', vscode.TreeItemCollapsibleState.None);
    t.command = { command: 'youtrack.loadMoreInView', title: 'Load more', arguments: [this.viewId] };
    return t;
  }
}
