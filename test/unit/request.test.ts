import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, HttpError } from '../../src/client/request';

function mockFetch(sequence: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const r = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response;
  });
  return { fn, calls };
}

describe('request', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns parsed body on 200', async () => {
    const { fn } = mockFetch([{ status: 200, body: { a: 1 } }]);
    const r = await request<{ a: number }>({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn });
    expect(r).toEqual({ a: 1 });
  });

  it('attaches bearer token', async () => {
    const fn = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{}',
    } as unknown as Response));
    await request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer t');
  });

  it('retries on 429 honoring Retry-After then succeeds', async () => {
    const { fn, calls } = mockFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200, body: { ok: true } },
    ]);
    const r = await request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn });
    expect(r).toEqual({ ok: true });
    expect(calls.length).toBe(2);
  });

  it('throws HttpError on 4xx (non-429)', async () => {
    const { fn } = mockFetch([{ status: 404, body: { error: 'not found' } }]);
    await expect(request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn }))
      .rejects.toBeInstanceOf(HttpError);
  });

  it('retries once on 5xx then fails', async () => {
    const { fn, calls } = mockFetch([
      { status: 500 },
      { status: 500 },
    ]);
    await expect(request({ baseUrl: 'https://x', token: 't', path: '/p', fetchImpl: fn }))
      .rejects.toBeInstanceOf(HttpError);
    expect(calls.length).toBe(2);
  });
});
