// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CtfState } from '../server/ctf/types';
import CtfApp from '../src/ctf/CtfApp';
import { useCtf } from '../src/ctf/useCtf';
import { ctfRequest } from '../src/ctf/api';

vi.mock('../src/ctf/CtfMap', () => ({ CtfMap: ({ onPlace }: { onPlace?: (p: { lat: number; lng: number }) => void }) =>
  <button onClick={() => onPlace?.({ lat: 1.3004, lng: 103.8 })}>Mock map placement</button> }));
vi.mock('../src/components/PlayerQr', () => ({ PlayerQr: () => <p>Runner QR</p> }));
vi.mock('../src/components/QrScanner', () => ({ QrScanner: () => <p>CTF scanner</p> }));
const at = 1_800_000_000_000;
function snapshot(phase: 'waiting' | 'active' | 'ended' = 'waiting'): CtfState {
  return {
    server_now: at, game: { code: 'ABCDEF', status: phase, start: { lat: 1.3, lng: 103.8 }, setup_version: 1,
      confirmed: true, ends_at: phase === 'waiting' ? null : at + 1_800_000, outcome: null, winner: null },
    me: { id: 'host', name: 'Host', role: 'catcher', is_host: true, tag_code: 'ABC123', qr_payload: 'ctf:ABCDEF:host:secret' },
    players: [{ id: 'host', name: 'Host', role: 'catcher', left: false, eligible: true, gps_ready: true,
      location: { lat: 1.3, lng: 103.8, accuracy: 5, captured_at: at } },
    { id: 'runner', name: 'Runner', role: 'runner', left: false, eligible: true, gps_ready: true,
      location: { lat: 1.3, lng: 103.8, accuracy: 5, captured_at: at } }],
    checkpoints: [ { id: '1', name: 'North', lat: 1.3004, lng: 103.8, captured_at: null, captured_by: null },
      { id: '2', name: 'East', lat: 1.2996, lng: 103.8003, captured_at: null, captured_by: null },
      { id: '3', name: 'West', lat: 1.2996, lng: 103.7997, captured_at: null, captured_by: null } ], attempt: null,
  };
}
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function reply(value: unknown) { return { ok: true, json: async () => value }; }

it('uses only the CTF API when creating a room and leaves the current game endpoints alone', async () => {
  let current: CtfState | null = null;
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith('/create')) current = snapshot();
    return reply({ state: current, server_now: at });
  });
  render(<CtfApp />); await flush();
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Host' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Capture the Flag' })); await flush();
  expect(screen.getByText('Set your starting area')).toBeTruthy();
  expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('/api/ctf/'))).toBe(true);
  expect(fetcher.mock.calls.find(([url]) => url === '/api/ctf/create')![1].body).toBe('{"name":"Host","code":""}');
  expect(screen.queryByLabelText('Increase duration by 30 minutes')).toBeNull();
  expect(screen.getByText(/Round duration: 30 minutes/)).toBeTruthy();
});

it('offers manual review after failed discovery and prevents starting with unconfirmed local edits', async () => {
  const state = snapshot();
  fetcher.mockImplementation(async (url: string) => reply(url.endsWith('/landmarks')
    ? { unavailable: true, suggestions: [], setup_version: 1 } : { state }));
  render(<CtfApp />); await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Suggest landmarks' })); await flush();
  expect(screen.getByText(/Landmarks could not load/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Confirm checkpoints' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Start Capture the Flag' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Mock map placement' }));
  expect((screen.getByLabelText('Flag 1') as HTMLInputElement).value).toBe('Checkpoint 1');
});

it('does not extrapolate captures during an outage and expires player GPS on the client', async () => {
  const state = snapshot('active'); state.me = { ...state.me, id: 'runner', name: 'Runner', role: 'runner', is_host: false };
  state.attempt = { checkpoint_id: '1', elapsed_ms: 55_000, last_received_at: at, last_captured_at: at };
  let offline = false;
  fetcher.mockImplementation(async () => { if (offline) throw new Error('offline'); return reply({ state }); });
  render(<CtfApp />); await flush();
  expect(screen.getByText('55 / 60 seconds verified')).toBeTruthy();
  offline = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
  expect(screen.getByText('0 / 60 seconds verified')).toBeTruthy();
  expect(screen.getByText(/Connection interrupted/)).toBeTruthy();
  expect(screen.getByText(/Fresh GPS accurate to 15 m is required/)).toBeTruthy();
  expect(screen.queryByText('Captured ✓')).toBeNull();
});

it('blocks the catcher action after GPS ages out and shows independent results', async () => {
  let state = snapshot('active');
  fetcher.mockImplementation(async () => reply({ state: { ...state, server_now: Date.now() } }));
  render(<CtfApp />); await flush();
  expect((screen.getByRole('button', { name: 'Scan / enter runner code' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
  expect((screen.getByRole('button', { name: 'Scan / enter runner code' }) as HTMLButtonElement).disabled).toBe(true);
  state = { ...state, game: { ...state.game, status: 'ended', outcome: 'time_up', winner: 'catchers' } };
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(screen.getByText('Catchers win!')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Scan / enter runner code' })).toBeNull();
});

it('stops GPS requests and uploads when hidden, ended or unmounted', async () => {
  let state = snapshot('active');
  const geo = vi.fn((success: PositionCallback) => success({ coords: { latitude: 1.3, longitude: 103.8, accuracy: 5 }, timestamp: Date.now() } as GeolocationPosition));
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: geo } });
  fetcher.mockImplementation(async (url: string) => reply(url.endsWith('/location') ? { accepted: true } : { state }));
  function Harness() { const ctf = useCtf(); return <button onClick={ctf.enableGps}>GPS</button>; }
  const view = render(<Harness />); await flush();
  fireEvent.click(screen.getByText('GPS')); await flush();
  expect(geo).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(geo).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  fireEvent(document, new Event('visibilitychange')); await flush();
  expect(geo).toHaveBeenCalledTimes(2);
  state = { ...state, game: { ...state.game, status: 'ended', outcome: 'time_up', winner: 'catchers' } };
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  const endCount = geo.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(geo).toHaveBeenCalledTimes(endCount);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(geo).toHaveBeenCalledTimes(endCount);
});

it('discards a pending GPS reading after the CTF screen unmounts', async () => {
  let callback: PositionCallback | undefined;
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (success: PositionCallback) => { callback = success; } } });
  fetcher.mockResolvedValue(reply({ state: snapshot('active') }));
  function Harness() { const ctf = useCtf(); return <button onClick={ctf.enableGps}>GPS</button>; }
  const view = render(<Harness />); await flush(); fireEvent.click(screen.getByText('GPS')); view.unmount();
  await act(async () => { callback?.({ coords: { latitude: 1.3, longitude: 103.8, accuracy: 5 }, timestamp: at } as GeolocationPosition); });
  expect(fetcher.mock.calls.some(([url]) => url === '/api/ctf/location')).toBe(false);
});

it('bounds stalled requests so GPS uploads and polling can recover', async () => {
  fetcher.mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const request = ctfRequest('state');
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(12_000);
  await rejected;
});
