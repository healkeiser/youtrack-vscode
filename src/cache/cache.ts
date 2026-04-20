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

export class Cache {
  private now: () => number;
  private issues = new Map<string, IssueEntry>();
  private savedQueriesEntry: SavedQueriesEntry | null = null;

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
