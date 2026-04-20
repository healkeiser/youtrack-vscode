import * as vscode from 'vscode';
import type { Cache } from '../cache/cache';
import type { YouTrackClient } from '../client/youtrackClient';
import type { Issue, SavedQuery } from '../client/types';

type Node =
  | { kind: 'query'; query: SavedQuery; loaded: Issue[]; skip: number; hasMore: boolean }
  | { kind: 'issue'; issue: Issue; parentQueryId: string }
  | { kind: 'loadMore'; parentQueryId: string };

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

export class IssueTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<Node | undefined>();
  onDidChangeTreeData = this._emitter.event;

  private queries = new Map<string, Node & { kind: 'query' }>();

  constructor(private client: YouTrackClient, private cache: Cache) {}

  refresh(): void {
    this.queries.clear();
    this._emitter.fire(undefined);
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
      const kids: Node[] = element.loaded.map((i) => ({ kind: 'issue', issue: i, parentQueryId: element.query.id }));
      if (element.hasMore) kids.push({ kind: 'loadMore', parentQueryId: element.query.id });
      return kids;
    }

    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'query') {
      const t = new vscode.TreeItem(node.query.name, vscode.TreeItemCollapsibleState.Collapsed);
      t.iconPath = new vscode.ThemeIcon('search');
      t.contextValue = 'query';
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
      t.description = state || undefined;
      t.command = { command: 'youtrack.openIssue', title: 'Open', arguments: [node.issue.idReadable] };
      t.contextValue = 'issue';
      t.tooltip = state ? `[${state}] ${node.issue.summary}` : node.issue.summary;
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
