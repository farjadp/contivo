import type {
  GenerateInstantContentRequest,
  GenerateInstantContentResponse,
} from '@contivo/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Error ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string>),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/v1${path}`, { headers, ...rest });

  if (!res.ok) {
    let body: { message?: string; code?: string; errors?: Record<string, string[]> } = {};
    try {
      body = await res.json();
    } catch {
      // ignore parse error
    }
    throw new ApiError(
      res.status,
      body.code ?? 'UNKNOWN',
      body.message ?? `Request failed with status ${res.status}`,
      body.errors,
    );
  }

  return res.json() as Promise<T>;
}

// ─── Instant Content ──────────────────────────────────────────────────────────

export async function generateInstantContent(
  payload: GenerateInstantContentRequest,
  token?: string,
): Promise<GenerateInstantContentResponse> {
  return apiFetch<GenerateInstantContentResponse>('/instant-content/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    token,
  });
}

export async function fetchInstantContentHistory(token?: string) {
  return apiFetch<{ items: GenerateInstantContentResponse['contentItem'][]; total: number }>(
    '/instant-content/history',
    { token },
  );
}

// ─── Credits ──────────────────────────────────────────────────────────────────

export async function getCreditsBalance(token?: string) {
  return apiFetch<{ balance: number }>('/credits/balance', { token });
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function checkHealth(): Promise<{ status: string }> {
  return apiFetch('/health');
}
