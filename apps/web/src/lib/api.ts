const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiHooks {
  getToken: () => string | null;
  onUnauthorized: () => void;
}

let hooks: ApiHooks = {
  getToken: () => null,
  onUnauthorized: () => undefined,
};

/** Wired up once by the AuthProvider so the client can read the token / react to 401s. */
export function configureApi(next: ApiHooks): void {
  hooks = next;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable body; sets Content-Type automatically. */
  json?: unknown;
  /** Raw body (e.g. a CSV string); set `headers['Content-Type']` yourself. */
  body?: BodyInit;
  /** Query-string params. `undefined` / `null` values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}/api/v1${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, query, headers, ...rest } = options;
  const finalHeaders = new Headers(headers);

  const token = hooks.getToken();
  if (token) finalHeaders.set('Authorization', `Bearer ${token}`);

  let body = rest.body;
  if (json !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }

  const response = await fetch(buildUrl(path, query), { ...rest, headers: finalHeaders, body });

  const raw = await response.text();
  const payload: unknown = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    // Only treat a 401 as an expired session when we actually presented a token.
    // A 401 with no token just means "not logged in yet" and must not force a logout.
    if (response.status === 401 && token) hooks.onUnauthorized();
    const err =
      (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error ?? {};
    throw new ApiError(
      response.status,
      err.code ?? 'ERROR',
      err.message ?? response.statusText,
      err.details,
    );
  }

  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
