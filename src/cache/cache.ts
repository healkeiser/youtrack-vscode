import type { Database } from 'better-sqlite3';
import { migrate } from './schema';
import type { Issue, SavedQuery } from '../client/types';

export interface CacheOptions {
  issuesTtlMs: number;
  maxIssues: number;
  fieldSchemasTtlMs?: number;
  savedQueriesTtlMs?: number;
  now?: () => number;
}

export class Cache {
  private now: () => number;

  constructor(private db: Database, private opts: CacheOptions) {
    this.now = opts.now ?? Date.now;
    migrate(db);
  }

  async getIssue(id: string, fetcher: (id: string) => Promise<Issue>): Promise<Issue> {
    const row = this.db.prepare('SELECT payload, fetched_at FROM issues WHERE id = ?').get(id) as
      { payload: string; fetched_at: number } | undefined;
    const now = this.now();
    if (row && now - row.fetched_at < this.opts.issuesTtlMs) {
      this.db.prepare('UPDATE issues SET accessed_at = ? WHERE id = ?').run(now, id);
      return JSON.parse(row.payload) as Issue;
    }
    const fresh = await fetcher(id);
    this.putIssue(fresh);
    return fresh;
  }

  putIssue(issue: Issue): void {
    const now = this.now();
    this.db.prepare(
      'INSERT OR REPLACE INTO issues (id, payload, fetched_at, accessed_at) VALUES (?, ?, ?, ?)'
    ).run(issue.idReadable, JSON.stringify(issue), now, now);
    this.evictLru();
  }

  invalidateIssue(id: string): void {
    this.db.prepare('DELETE FROM issues WHERE id = ?').run(id);
  }

  private evictLru(): void {
    const count = (this.db.prepare('SELECT COUNT(*) AS c FROM issues').get() as { c: number }).c;
    if (count <= this.opts.maxIssues) return;
    const overflow = count - this.opts.maxIssues;
    const rows = this.db.prepare('SELECT id FROM issues ORDER BY accessed_at ASC LIMIT ?').all(overflow) as { id: string }[];
    const del = this.db.prepare('DELETE FROM issues WHERE id = ?');
    for (const r of rows) del.run(r.id);
  }

  async getSavedQueries(fetcher: () => Promise<SavedQuery[]>): Promise<SavedQuery[]> {
    const ttl = this.opts.savedQueriesTtlMs ?? 5 * 60_000;
    const row = this.db.prepare('SELECT payload, fetched_at FROM saved_queries WHERE id = 1').get() as
      { payload: string; fetched_at: number } | undefined;
    const now = this.now();
    if (row && now - row.fetched_at < ttl) return JSON.parse(row.payload) as SavedQuery[];
    const fresh = await fetcher();
    this.db.prepare('INSERT OR REPLACE INTO saved_queries (id, payload, fetched_at) VALUES (1, ?, ?)')
      .run(JSON.stringify(fresh), now);
    return fresh;
  }
}
