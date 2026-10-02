/**
 * Typed HTTP client for the Express API.
 *
 * Used from server components, route handlers and server actions — never from the browser,
 * because the access token lives in an httpOnly cookie the client cannot read.
 */

/**
 * Where the API lives.
 *
 * Defaults to this deployment, because the API is served from `/api/v1` of the same origin
 * — one Vercel project, no CORS, no second domain to configure. `NEXT_PUBLIC_API_URL` still
 * overrides it, which is what a split deployment or a VPS running the standalone Express
 * server sets.
 *
 * An absolute URL is required even for same-origin: these calls run on the server, where a
 * relative path has no host to resolve against. `VERCEL_URL` covers preview deployments,
 * whose domain is generated per commit and not known in advance.
 */
function resolveApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();
export const API_BASE = `${API_URL}/api/v1`;

/** Mirrors the API's error envelope so callers can branch on `code`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuth() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Bearer token. Omitted for login and refresh. */
  token?: string;
  /** Sets X-Account-Id, which the API uses to resolve tenant context. */
  accountId?: string;
  /** The context chosen at login. Narrows which membership the API resolves. */
  context?: string;
  /** Forwarded to fetch; server components default to no caching. */
  cache?: RequestCache;
  /** Next.js revalidation tag support. */
  tags?: string[];
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, accountId, context, cache = 'no-store', tags } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (accountId) headers['X-Account-Id'] = accountId;
  if (context) headers['X-Context'] = context;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache,
      ...(tags ? { next: { tags } } : {}),
    });
  } catch (err) {
    // A connection refused here almost always means the API isn't running, which is
    // worth saying plainly rather than surfacing "fetch failed" to a user.
    throw new ApiError(
      503,
      'API_UNREACHABLE',
      `Could not reach the API at ${API_URL}. Is it running?`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? safeParse(text) : null;

  if (!res.ok) {
    const e = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'UNKNOWN',
      e?.message ?? `Request failed with ${res.status}`,
      e?.details,
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
