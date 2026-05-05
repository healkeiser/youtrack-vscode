import type { Issue, SavedQuery } from '../client/types';

export interface CacheOptions {
  issuesTtlMs: number;
  maxIssues: number;
  fieldSchemasTtlMs?: number;
  savedQueriesTtlMs?: number;
  now?: () => number;
}

interface IssueEntry {
  payload: Issue;
  fetchedAt: number;
  accessedAt: number;
}

interface SavedQueriesEntry {
  payload: SavedQuery[];
  fetchedAt: number;
}

export type IssueChangeKind = 'created' | 'updated';

export interface IssueChangeEvent {
  kind: IssueChangeKind;
  /** Readable id (e.g. ABC-123) when known. Absent for bulk/unknown changes. */
  id?: string;
}

export type IssueChangeListener = (e: IssueChangeEvent) => void;

export class Cache {
  private now: () => number;
  private issues = new Map<string, IssueEntry>();
  private savedQueriesEntry: SavedQueriesEntry | null = null;
  private changeListeners = new Set<IssueChangeListener>();

  constructor(private opts: CacheOptions) {
    this.now = opts.now ?? Date.now;
  }

  async getIssue(id: string, fetcher: (id: string) => Promise<Issue>): Promise<Issue> {
    const now = this.now();
    const entry = this.issues.get(id);
    if (entry && now - entry.fetchedAt < this.opts.issuesTtlMs) {
      entry.accessedAt = now;
      return entry.payload;
    }
    const fresh = await fetcher(id);
    this.putIssue(fresh);
    return fresh;
  }

  putIssue(issue: Issue): void {
    const now = this.now();
    this.issues.set(issue.idReadable, { payload: issue, fetchedAt: now, accessedAt: now });
    this.evictLru();
  }

  invalidateIssue(id: string): void {
    this.issues.delete(id);
    this.fireChange({ kind: 'updated', id });
  }

  // Mutation sites that aren't tied to an existing cache entry — e.g.
  // creating a brand new issue — call this so the same subscribers that
  // react to invalidateIssue() also pick up the new arrival.
  notifyCreated(id?: string): void {
    this.fireChange({ kind: 'created', id });
  }

  onChange(listener: IssueChangeListener): { dispose(): void } {
    this.changeListeners.add(listener);
    return { dispose: () => { this.changeListeners.delete(listener); } };
  }

  private fireChange(e: IssueChangeEvent): void {
    for (const l of this.changeListeners) {
      try { l(e); } catch { /* listener errors must not break callers */ }
    }
  }

  private evictLru(): void {
    if (this.issues.size <= this.opts.maxIssues) return;
    const overflow = this.issues.size - this.opts.maxIssues;
    const sorted = [...this.issues.entries()].sort((a, b) => a[1].accessedAt - b[1].accessedAt);
    for (let i = 0; i < overflow; i++) {
      this.issues.delete(sorted[i][0]);
    }
  }

  async getSavedQueries(fetcher: () => Promise<SavedQuery[]>): Promise<SavedQuery[]> {
    const ttl = this.opts.savedQueriesTtlMs ?? 5 * 60_000;
    const now = this.now();
    if (this.savedQueriesEntry && now - this.savedQueriesEntry.fetchedAt < ttl) {
      return this.savedQueriesEntry.payload;
    }
    const fresh = await fetcher();
    this.savedQueriesEntry = { payload: fresh, fetchedAt: now };
    return fresh;
  }
}
