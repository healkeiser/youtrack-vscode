export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body}`);
  }
}

export interface RequestOptions {
  baseUrl: string;
  token: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  fetchImpl?: typeof fetch;
  maxRateLimitRetries?: number;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function request<T>(opts: RequestOptions): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const url = buildUrl(opts.baseUrl, opts.path, opts.query);
  const maxRl = opts.maxRateLimitRetries ?? 3;
  let rlTries = 0;
  let srvTries = 0;

  while (true) {
    const res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 429 && rlTries < maxRl) {
      const after = Number(res.headers.get('Retry-After') ?? '1');
      await sleep(Math.max(0, after) * 1000);
      rlTries++;
      continue;
    }

    if (res.status >= 500 && srvTries < 1) {
      srvTries++;
      continue;
    }

    if (!res.ok) {
      throw new HttpError(res.status, await res.text());
    }

    return (await res.json()) as T;
  }
}
