import type { CtfState, LandmarkResult } from '../../server/ctf/types';

export async function ctfRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  // Give the server's bounded landmark lookup time to return its manual-placement fallback.
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch(`/api/ctf/${path}`, { method, credentials: 'same-origin', signal: controller.signal,
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? 'Capture the Flag could not connect.');
    return result as T;
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort);
  }
}
export type StateResponse = { state: CtfState | null; server_now?: number };
export type SuggestionsResponse = LandmarkResult & { setup_version: number };
