import * as vscode from 'vscode';
import type { Cache } from '../cache/cache';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Issue } from '../client/types';
import type { SidebarState } from './sidebarState';
import type { QuerySource } from './queryTreeProvider';
import { stateVisuals } from '../util/stateVisuals';

type Node =
  | { kind: 'section'; sectionId: string }
  | { kind: 'project'; sectionId: string; shortName: string; issues: Issue[] }
  | { kind: 'issue'; issue: Issue }
  | { kind: 'loadMore'; sectionId: string };

interface SectionState {
  id: string;
  label: string;
  source: QuerySource;
  loaded: Issue[];
  hasMore: boolean;
  skip: number;
  expanded: boolean;
  resolvedSavedQueryId?: string;
  loading: Promise<void> | null;
}

const PAGE_SIZE = 50;

function issueStateName(issue: Issue): string {
  const f = issue.customFields.find((x) => x.name === 'State');
  if (!f) return '';
  const v = f.value;
  if (v.kind === 'state' || v.kind === 'enum') return v.name;
  return '';
}


export class MultiQueryTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<Node | undefined>();
  onDidChangeTreeData = this._emitter.event;
  private sections = new Map<string, SectionState>();

  constructor(
    public readonly viewId: string,
    private client: YouTrackClient,
    private cache: Cache,
    private state: SidebarState,
    sources: Array<{ id: string; label: string; source: QuerySource }>,
  ) {
    for (const s of sources) {
      this.sections.set(s.id, {
        id: s.id,
        label: s.label,
        source: s.source,
        loaded: [],
        hasMore: true,
        skip: 0,
        expanded: false,
        loading: null,
      });
    }
    state.onDidChange(() => this._emitter.fire(undefined));
  }

  refresh(): void {
    for (const s of this.sections.values()) {
      s.loaded = [];
      s.hasMore = true;
      s.skip = 0;
      s.resolvedSavedQueryId = undefined;
      s.loading = null;
    }
    this._emitter.fire(undefined);
  }

  async loadMore(sectionId: string): Promise<void> {
    const s = this.sections.get(sectionId);
    if (!s) return;
    const page = await this.fetchPage(s, s.skip);
    s.loaded = s.loaded.concat(page);
    s.skip += page.length;
    s.hasMore = page.length === PAGE_SIZE;
    for (const i of page) this.cache.putIssue(i);
    this._emitter.fire(undefined);
  }

  private async fetchPage(s: SectionState, skip: number): Promise<Issue[]> {
    if (s.source.savedQueryName && s.resolvedSavedQueryId === undefined) {
      const saved = await this.cache.getSavedQueries(() => this.client.fetchSavedQueries());
      const target = s.source.savedQueryName.toLowerCase();
      const hit = saved.find((q) => q.name.toLowerCase() === target);
      if (hit) s.resolvedSavedQueryId = hit.id;
    }
    return s.resolvedSavedQueryId
      ? this.client.searchSavedQueryIssues(s.resolvedSavedQueryId, skip, PAGE_SIZE)
      : this.client.searchIssues(s.source.directQuery ?? '', skip, PAGE_SIZE);
  }

  private async ensureFirstPage(s: SectionState): Promise<void> {
    if (s.loaded.length > 0 || !s.hasMore) return;
    if (s.loading) { await s.loading; return; }
    s.loading = (async () => {
      try {
        const first = await this.fetchPage(s, 0);
        s.loaded = first;
        s.skip = first.length;
        s.hasMore = first.length === PAGE_SIZE;
        for (const i of first) this.cache.putIssue(i);
      } finally {
        s.loading = null;
      }
    })();
    await s.loading;
  }

  getAllLoaded(): Issue[] {
    const out: Issue[] = [];
    for (const s of this.sections.values()) out.push(...s.loaded);
    return out;
  }

  private matches(issue: Issue): boolean {
    const { filterText, stateFilter, tagFilter } = this.state;
    if (filterText) {
      const hay = `${issue.idReadable} ${issue.summary} ${issue.assignee?.login ?? ''} ${issue.assignee?.fullName ?? ''} ${issue.project.shortName}`.toLowerCase();
      if (!hay.includes(filterText)) return false;
    }
    if (stateFilter.size > 0 && !stateFilter.has(issueStateName(issue))) return false;
    if (tagFilter.size > 0 && !issue.tags.some((t) => tagFilter.has(t.name))) return false;
    if (this.state.unresolvedOnly && issue.resolved) return false;
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

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      return [...this.sections.values()].map((s) => ({ kind: 'section' as const, sectionId: s.id }));
    }
    if (element.kind === 'section') {
      const s = this.sections.get(element.sectionId);
      if (!s) return [];
      await this.ensureFirstPage(s);
      const visible = this.sort(s.loaded.filter((i) => this.matches(i)));
      // Pagination is server-side; client-side filters (text/state/tag/
      // unresolvedOnly) narrow the loaded pool but must not gate "Load
      // more", or sections become unreachable past the first page when
      // any filter is active.
      const loadMoreNode: Node[] = s.hasMore ? [{ kind: 'loadMore', sectionId: s.id }] : [];
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
          ...sorted.map(([shortName, issues]) => ({ kind: 'project' as const, sectionId: s.id, shortName, issues })),
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
    if (node.kind === 'section') {
      const s = this.sections.get(node.sectionId)!;
      const t = new vscode.TreeItem(s.label, vscode.TreeItemCollapsibleState.Collapsed);
      t.iconPath = new vscode.ThemeIcon('search');
      t.contextValue = 'section';
      if (s.loaded.length) {
        const visibleCount = s.loaded.filter((i) => this.matches(i)).length;
        t.description = this.state.anyFilterActive()
          ? `${visibleCount} / ${s.loaded.length}`
          : String(s.loaded.length);
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
      const t = new vscode.TreeItem(
        `${node.issue.idReadable}  ${node.issue.summary}`,
        vscode.TreeItemCollapsibleState.None,
      );
      t.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
      const parts: string[] = [];
      if (state) parts.push(state);
      if (node.issue.tags.length) parts.push(node.issue.tags.map((tg) => `#${tg.name}`).join(' '));
      t.description = parts.length ? parts.join('  ·  ') : undefined;
      t.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [node.issue.idReadable] };
      t.contextValue = 'issue';
      const tip = new vscode.MarkdownString();
      if (state) tip.appendMarkdown(`**${state}**  \n`);
      tip.appendMarkdown(node.issue.summary);
      t.tooltip = tip;
      return t;
    }
    const t = new vscode.TreeItem('Load more...', vscode.TreeItemCollapsibleState.None);
    t.command = { command: 'youtrack.loadMoreInSection', title: 'Load more', arguments: [node.sectionId] };
    return t;
  }
}
