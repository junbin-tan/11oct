// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { GameState } from '../src/types';
import { Lobby } from '../src/views/Lobby';
import { Results } from '../src/views/Results';

// The embedded radar map has its own integration coverage.
vi.mock('../src/components/RadarMap', () => ({ RadarMap: () => null }));

const api = vi.hoisted(() => ({ getState: vi.fn(), updateSettings: vi.fn(), getRadar: vi.fn(), updateLocation: vi.fn() }));
vi.mock('../src/api', () => ({ api, ApiError: class extends Error {} }));

function round(status: GameState['game']['status'] = 'active'): GameState {
  const now = Date.now();
  return {
    server_now: now,
    me: { player_id: 'host', name: 'Host', role: 'catcher', is_host: true, tag_code: 'ABC123', qr_payload: 'tag:ABCDEF:host:token' },
    game: { code: 'ABCDEF', status, host_player_id: 'host', created_at: now, started_at: now, ended_at: null,
      duration_minutes: 30, ends_at: status === 'waiting' ? null : now + 30 * 60_000, end_reason: null },
    players: [
      { id: 'host', name: 'Host', role: 'catcher', is_host: true, gps_ready: false, tag_count: 0, caught_at: null, left_at: null },
      { id: 'guest', name: 'Guest', role: 'runner', is_host: false, gps_ready: false, tag_count: 0, caught_at: null, left_at: null },
    ],
    events: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  window.history.replaceState(null, '', '/');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  api.getRadar.mockResolvedValue({ points: [], origin_available: false, next_ping_at: null,
    snapshot_at: null, missing_gps_count: 0, outside_range_count: 0, server_now: Date.now() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('saves duration changes immediately and shows failed saves without changing the chosen duration', async () => {
  const state = round('waiting');
  api.getState.mockImplementation(async () => ({ state }));
  api.updateSettings.mockImplementationOnce(async (duration: number) => {
    state.game.duration_minutes = duration;
    return { state: { ...state } };
  }).mockRejectedValueOnce(new Error('Connection lost.'));
  render(<App />);
  await act(async () => {});
  expect((screen.getByRole('button', { name: 'Decrease duration by 30 minutes' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Increase duration by 30 minutes' })));
  expect(api.updateSettings).toHaveBeenCalledWith(60);
  expect(screen.getByText('Catch everyone in 60 minutes.')).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Increase duration by 30 minutes' })));
  expect(screen.getByText('Connection lost.')).toBeTruthy();
  expect(screen.getByText('Catch everyone in 60 minutes.')).toBeTruthy();
});

it('caps the control at six hours and gives guests a read-only duration', () => {
  const state = round('waiting');
  state.game.duration_minutes = 360;
  const props = { state, busy: false, gpsStatus: 'off' as const, onEnableGps: vi.fn(), onResetGps: vi.fn(),
    onStart: vi.fn(), onDurationChange: vi.fn(), onExit: vi.fn() };
  const view = render(<Lobby {...props} />);
  expect((screen.getByRole('button', { name: 'Increase duration by 30 minutes' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Decrease duration by 30 minutes' }));
  expect(props.onDurationChange).toHaveBeenCalledWith(330);
  view.rerender(<Lobby {...props} state={{ ...state, me: { ...state.me, is_host: false } }} />);
  expect(screen.queryByRole('button', { name: /duration by 30/ })).toBeNull();
  expect(screen.getByText('Catch everyone in 360 minutes.')).toBeTruthy();
});

it('uses server time and the persisted deadline across ticking and reloads', async () => {
  const state = round();
  state.game.started_at! += 120_000;
  state.game.ends_at! += 120_000;
  api.getState.mockImplementation(async () => ({ state: { ...state, server_now: Date.now() + 120_000 } }));
  const view = render(<App />);
  await act(async () => {});
  expect(screen.getByRole('timer').textContent).toBe('30:00Time left');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole('timer').textContent).toBe('29:59Time left');
  view.unmount();
  vi.setSystemTime(1_000_000 + 10 * 60_000);
  render(<App />);
  await act(async () => {});
  expect(screen.getByRole('timer').textContent).toBe('20:00Time left');
});

it('closes QR controls, stops GPS and refreshes results at zero, even offline', async () => {
  const state = round();
  state.me.role = 'runner';
  state.game.ends_at = Date.now() + 1000;
  api.getState.mockResolvedValue({ state });
  const clearWatch = vi.fn();
  let report!: PositionCallback;
  const watchPosition = vi.fn((callback: PositionCallback) => { report = callback; return 42; });
  Object.defineProperty(navigator, 'geolocation', { configurable: true,
    value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() } });
  api.updateLocation.mockReturnValue(new Promise(() => {}));
  render(<App />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Enable GPS' }));
  await act(async () => report({ coords: { latitude: 1.3, longitude: 103.8, accuracy: 5 }, timestamp: Date.now() } as GeolocationPosition));
  fireEvent.click(screen.getByRole('button', { name: 'Show my QR' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  const calls = api.getState.mock.calls.length;
  api.getState.mockRejectedValue(new Error('Offline'));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(api.getState.mock.calls.length).toBeGreaterThan(calls);
  expect(screen.getByRole('timer').textContent).toBe('0:00Time left');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByRole('button', { name: 'Show my QR' }) as HTMLButtonElement).disabled).toBe(true);
  expect(clearWatch).toHaveBeenCalledWith(42);
  expect((api.updateLocation.mock.calls[0]![4] as AbortSignal).aborted).toBe(true);
  expect(screen.getByText('Time’s up—reconnecting for results.')).toBeTruthy();
  state.game = { ...state.game, status: 'ended', end_reason: 'time_up', ended_at: state.game.ends_at };
  api.getState.mockResolvedValue({ state });
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByRole('heading', { name: 'Time’s up! Runners win' })).toBeTruthy();
});

it('updates immediately when returning from a suspended tab after the deadline', async () => {
  const state = round();
  api.getState.mockResolvedValue({ state });
  render(<App />);
  await act(async () => {});
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
  vi.setSystemTime(state.game.ends_at! + 1000);
  api.getState.mockRejectedValue(new Error('Offline'));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => fireEvent(document, new Event('visibilitychange')));
  expect(screen.getByRole('timer').textContent).toBe('0:00Time left');
  expect((screen.getByRole('button', { name: 'Scan to tag' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Time’s up—reconnecting for results.')).toBeTruthy();
});

it('shows timeout winners, excludes withdrawals, and reports the deadline duration', () => {
  const state = round('ended');
  state.game.end_reason = 'time_up';
  state.game.ended_at = state.game.ends_at;
  state.players.push({ ...state.players[1]!, id: 'left', name: 'Lefty', left_at: Date.now() });
  render(<Results state={state} busy={false} onNewGame={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Time’s up! Runners win' })).toBeTruthy();
  expect(screen.getByText('Guest survived the 30-minute chase.')).toBeTruthy();
  expect(screen.getByText('Time played').parentElement?.textContent).toBe('30:00Time played');
  expect(screen.getByText('Survivor').parentElement?.textContent).toBe('1Survivor');
});
