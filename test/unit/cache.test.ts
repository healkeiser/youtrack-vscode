import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Cache } from '../../src/cache/cache';
import type { Issue } from '../../src/client/types';

function makeIssue(id: string): Issue {
  return {
    id, idReadable: id, summary: `Issue ${id}`, description: '',
    project: { id: 'p', shortName: 'P' },
    reporter: null, assignee: null,
    created: 0, updated: 0, customFields: [],
  };
}

describe('Cache', () => {
  let cache: Cache;
  let fetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const db = new Database(':memory:');
    fetcher = vi.fn(async (id: string) => makeIssue(id));
    cache = new Cache(db, { issuesTtlMs: 1000, maxIssues: 3, now: () => 0 });
  });

  it('fetches on miss and returns same on hit', async () => {
    const a = await cache.getIssue('A', fetcher);
    const b = await cache.getIssue('A', fetcher);
    expect(a.idReadable).toBe('A');
    expect(b.idReadable).toBe('A');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL expiry', async () => {
    let now = 0;
    cache = new Cache(new Database(':memory:'), { issuesTtlMs: 100, maxIssues: 10, now: () => now });
    await cache.getIssue('A', fetcher);
    now = 200;
    await cache.getIssue('A', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('evicts LRU beyond capacity', async () => {
    await cache.getIssue('A', fetcher);
    await cache.getIssue('B', fetcher);
    await cache.getIssue('C', fetcher);
    await cache.getIssue('D', fetcher); // evicts A
    await cache.getIssue('A', fetcher); // refetches A
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
