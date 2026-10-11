// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function hangingFetch(bodyOnly = false) {
  return vi.fn((_url: string, options: RequestInit) => {
    const aborted = new Promise<never>((_resolve, reject) => {
      const cancel = () => reject(new DOMException('aborted', 'AbortError'));
      options.signal!.addEventListener('abort', cancel, { once: true });
      if (options.signal!.aborted) cancel();
    });
    return bodyOnly ? Promise.resolve({ ok: true, json: () => aborted }) : aborted;
  });
}

it.each([false, true])('times out a hanging radar request, including body parsing (%s)', async (bodyOnly) => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', hangingFetch(bodyOnly));
  const check = expect(api.getRadar()).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(10_000);
  await check;
  expect(vi.getTimerCount()).toBe(0);
});

it('aborts a location request when tracking is stopped', async () => {
  vi.useFakeTimers();
  const fetch = hangingFetch(); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const check = expect(api.updateLocation(1, 2, 5, 1000, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  controller.abort(); await check;
  expect((fetch.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('sends the capture timestamp and returns an explicit rejection acknowledgement', async () => {
  const ack = { accepted: false, reason: 'older', next_upload_at: 6000, server_now: 1000 };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ack });
  vi.stubGlobal('fetch', fetch);
  expect(await api.updateLocation(1, 2, 5, 900)).toEqual(ack);
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ lat: 1, lng: 2, accuracy: 5, captured_at: 900 });
});
