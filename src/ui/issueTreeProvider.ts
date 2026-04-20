import * as vscode from 'vscode';
import type { Cache } from '../cache/cache';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Issue, SavedQuery } from '../client/types';

type Node =
  | { kind: 'query'; query: SavedQuery; loaded: Issue[]; skip: number; hasMore: boolean }
  | { kind: 'project'; parentQueryId: string; shortName: string; issues: Issue[] }
  | { kind: 'issue'; issue: Issue; parentQueryId: string }
  | { kind: 'loadMore'; parentQueryId: string };

export type GroupMode = 'none' | 'project';
export type SortMode = 'default' | 'updated' | 'created' | 'id';

const PAGE_SIZE = 50;

interface StateVisuals {
  icon: string;
  color?: string;
}

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

function groupByProject(issues: Issue[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  for (const i of issues) {
    const key = i.project.shortName || '—';
    const list = out.get(key);
    if (list) list.push(i);
    else out.set(key, [i]);
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export class IssueTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<Node | undefined>();
  onDidChangeTreeData = this._emitter.event;

  private queries = new Map<string, Node & { kind: 'query' }>();
  private filterText = '';
  private groupMode: GroupMode = 'project';
  private stateFilter = new Set<string>();
  private tagFilter = new Set<string>();
  private sortMode: SortMode = 'default';

  constructor(private client: YouTrackClient, private cache: Cache) {}

  refresh(): void {
    this.queries.clear();
    this._emitter.fire(undefined);
  }

  setFilter(text: string): void {
    this.filterText = text.trim().toLowerCase();
    this._emitter.fire(undefined);
  }

  getFilter(): string {
    return this.filterText;
  }

  setGroupMode(mode: GroupMode): void {
    if (this.groupMode === mode) return;
    this.groupMode = mode;
    this._emitter.fire(undefined);
  }

  getGroupMode(): GroupMode {
    return this.groupMode;
  }

  setStateFilter(states: string[]): void {
    this.stateFilter = new Set(states);
    this._emitter.fire(undefined);
  }

  getStateFilter(): string[] {
    return [...this.stateFilter];
  }

  setSortMode(mode: SortMode): void {
    if (this.sortMode === mode) return;
    this.sortMode = mode;
    this._emitter.fire(undefined);
  }

  getSortMode(): SortMode {
    return this.sortMode;
  }

  getAvailableStates(): string[] {
    const set = new Set<string>();
    for (const q of this.queries.values()) {
      for (const i of q.loaded) {
        const s = issueStateName(i);
        if (s) set.add(s);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  getAvailableTags(): string[] {
    const set = new Set<string>();
    for (const q of this.queries.values()) {
      for (const i of q.loaded) {
        for (const t of i.tags) set.add(t.name);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  setTagFilter(tags: string[]): void {
    this.tagFilter = new Set(tags);
    this._emitter.fire(undefined);
  }

  getTagFilter(): string[] {
    return [...this.tagFilter];
  }

  private matchesFilter(issue: Issue): boolean {
    if (this.filterText) {
      const hay = `${issue.idReadable} ${issue.summary} ${issue.assignee?.login ?? ''} ${issue.assignee?.fullName ?? ''} ${issue.project.shortName}`.toLowerCase();
      if (!hay.includes(this.filterText)) return false;
    }
    if (this.stateFilter.size > 0) {
      const state = issueStateName(issue);
      if (!this.stateFilter.has(state)) return false;
    }
    if (this.tagFilter.size > 0) {
      const names = issue.tags.map((t) => t.name);
      if (!names.some((n) => this.tagFilter.has(n))) return false;
    }
    return true;
  }

  private sortIssues(issues: Issue[]): Issue[] {
    if (this.sortMode === 'default') return issues;
    const sorted = [...issues];
    if (this.sortMode === 'updated') sorted.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    else if (this.sortMode === 'created') sorted.sort((a, b) => (b.created || 0) - (a.created || 0));
    else if (this.sortMode === 'id') sorted.sort((a, b) => a.idReadable.localeCompare(b.idReadable, undefined, { numeric: true }));
    return sorted;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const queries = await this.cache.getSavedQueries(() => this.client.fetchSavedQueries());
      const nodes: (Node & { kind: 'query' })[] = queries.map((q) => ({
        kind: 'query', query: q, loaded: [], skip: 0, hasMore: true,
      }));
      this.queries.clear();
      for (const n of nodes) this.queries.set(n.query.id, n);
      return nodes;
    }

    if (element.kind === 'query') {
      if (element.loaded.length === 0) {
        const issues = await this.client.searchSavedQueryIssues(element.query.id, 0, PAGE_SIZE);
        element.loaded = issues;
        element.skip = issues.length;
        element.hasMore = issues.length === PAGE_SIZE;
        for (const i of issues) this.cache.putIssue(i);
      }
      const visible = this.sortIssues(element.loaded.filter((i) => this.matchesFilter(i)));

      const anyActiveFilter = this.filterText || this.stateFilter.size > 0;
      const loadMore: Node[] = element.hasMore && !anyActiveFilter
        ? [{ kind: 'loadMore', parentQueryId: element.query.id }]
        : [];

      if (this.groupMode === 'project') {
        const grouped = groupByProject(visible);
        const kids: Node[] = [...grouped.entries()].map(([shortName, issues]) => ({
          kind: 'project', parentQueryId: element.query.id, shortName, issues,
        }));
        return [...kids, ...loadMore];
      }

      const kids: Node[] = visible.map((i) => ({ kind: 'issue', issue: i, parentQueryId: element.query.id }));
      return [...kids, ...loadMore];
    }

    if (element.kind === 'project') {
      return element.issues.map((i) => ({ kind: 'issue', issue: i, parentQueryId: element.parentQueryId }));
    }

    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'query') {
      const t = new vscode.TreeItem(node.query.name, vscode.TreeItemCollapsibleState.Collapsed);
      t.iconPath = new vscode.ThemeIcon('search');
      t.contextValue = 'query';
      if (node.loaded.length === 0) {
        // nothing fetched yet — omit the badge entirely
      } else if (this.filterText || this.stateFilter.size > 0) {
        const matches = node.loaded.filter((i) => this.matchesFilter(i)).length;
        t.description = `${matches} / ${node.loaded.length}`;
      } else {
        t.description = String(node.loaded.length);
      }
      return t;
    }
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
      const idLen = node.issue.idReadable.length;
      const label: vscode.TreeItemLabel = {
        label: `${node.issue.idReadable}  ${node.issue.summary}`,
        highlights: [[0, idLen]],
      };
      const t = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      t.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
      const tagNames = node.issue.tags.map((t) => t.name);
      const descParts: string[] = [];
      if (state) descParts.push(state);
      if (tagNames.length) descParts.push(tagNames.map((n) => `#${n}`).join(' '));
      t.description = descParts.length ? descParts.join('  ·  ') : undefined;
      t.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [node.issue.idReadable] };
      t.contextValue = 'issue';
      const tooltip = new vscode.MarkdownString();
      tooltip.supportThemeIcons = true;
      if (state) tooltip.appendMarkdown(`**${state}**  \n`);
      tooltip.appendMarkdown(`${node.issue.summary}\n`);
      if (tagNames.length) tooltip.appendMarkdown(`\n\n_Tags:_ ${tagNames.map((n) => `\`#${n}\``).join(' ')}`);
      t.tooltip = tooltip;
      return t;
    }
    const t = new vscode.TreeItem('Load more...', vscode.TreeItemCollapsibleState.None);
    t.command = { command: 'youtrack.loadMore', title: 'Load more', arguments: [node.parentQueryId] };
    return t;
  }

  async loadMore(parentQueryId: string): Promise<void> {
    const q = this.queries.get(parentQueryId);
    if (!q) return;
    const more = await this.client.searchSavedQueryIssues(q.query.id, q.skip, PAGE_SIZE);
    q.loaded = q.loaded.concat(more);
    q.skip += more.length;
    q.hasMore = more.length === PAGE_SIZE;
    for (const i of more) this.cache.putIssue(i);
    this._emitter.fire(q);
  }
}
