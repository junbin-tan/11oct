// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ExitButton } from '../src/components/ExitButton';
import { useGame } from '../src/hooks/useGame';
import type { GameState } from '../src/types';
import { Results } from '../src/views/Results';

// The embedded radar map has its own integration coverage.
vi.mock('../src/components/RadarMap', () => ({ RadarMap: () => null }));

const api = vi.hoisted(() => ({ getState: vi.fn(), leaveGame: vi.fn(), getRadar: vi.fn(), updateLocation: vi.fn() }));
vi.mock('../src/api', () => ({ api, ApiError: class extends Error {} }));

function membership(status: GameState['game']['status'] = 'active'): GameState {
  return {
    server_now: Date.now(),
    me: { player_id: 'guest', name: 'Guest', role: 'runner', is_host: false, tag_code: 'ABC123', qr_payload: 'tag:ABCDEF:guest:token' },
    game: { code: 'ABCDEF', status, host_player_id: 'host', created_at: 1000, started_at: 2000, ended_at: null, duration_minutes: 30, ends_at: null, end_reason: null },
    players: [
      { id: 'host', name: 'Host', role: 'catcher', is_host: true, gps_ready: false, tag_count: 2, caught_at: null, left_at: null },
      { id: 'guest', name: 'Guest', role: 'runner', is_host: false, gps_ready: false, tag_count: 0, caught_at: null, left_at: null },
    ],
    events: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
  api.getState.mockResolvedValue({ state: membership() });
  api.leaveGame.mockResolvedValue({ state: null });
  api.getRadar.mockResolvedValue({ points: [], origin_available: false, next_ping_at: null,
    snapshot_at: null, missing_gps_count: 0, outside_range_count: 0, server_now: Date.now() });
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('exit confirmation', () => {
  it('cancels without leaving and restores focus', () => {
    const onExit = vi.fn();
    render(<ExitButton phase="lobby" isHost={false} busy={false} onExit={onExit} />);
    const opener = screen.getByRole('button', { name: 'Exit room' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['lobby', 'game'] as const)('warns the host about ending the %s for everyone', (phase) => {
    render(<ExitButton phase={phase} isHost busy={false} onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/You’re the host.*everyone/)).toBeTruthy();
    expect(screen.getByText(/stop sharing your location/)).toBeTruthy();
  });

  it('blocks duplicate requests and dismissal while pending, and lets a failed exit retry', async () => {
    const request = deferred<string | null>();
    const onExit = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(null);
    render(<ExitButton phase="game" isHost={false} busy={false} onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exit game' }));
    const exit = screen.getByRole('button', { name: 'Exit' });
    fireEvent.click(exit);
    fireEvent.click(exit);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Stay' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => request.resolve('Connection lost.'));
    expect(screen.getByRole('alert').textContent).toContain('try exiting again');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Exit' })));
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('app exit lifecycle', () => {
  it.each(['waiting', 'active'] as const)('returns home from %s, stops GPS and radar, and stays home', async (phase) => {
    vi.useFakeTimers();
    api.getState.mockResolvedValue({ state: membership(phase) });
    const clearWatch = vi.fn();
    let report!: PositionCallback;
    const watchPosition = vi.fn((callback: PositionCallback) => { report = callback; return 42; });
    api.updateLocation.mockReturnValue(new Promise(() => {}));
    Object.defineProperty(navigator, 'geolocation', { configurable: true,
      value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() } });
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Enable GPS' }));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    const sample = { coords: { latitude: 1.3, longitude: 103.8, accuracy: 5 }, timestamp: Date.now() } as GeolocationPosition;
    await act(async () => report(sample));
    expect(api.updateLocation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: phase === 'waiting' ? 'Exit room' : 'Exit game' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Exit' })));
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(clearWatch).toHaveBeenCalledWith(42);
    expect((api.updateLocation.mock.calls[0]![4] as AbortSignal).aborted).toBe(true);
    const stateCalls = api.getState.mock.calls.length;
    const radarCalls = api.getRadar.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(api.getState).toHaveBeenCalledTimes(stateCalls);
    expect(api.getRadar).toHaveBeenCalledTimes(radarCalls);
    expect(api.updateLocation).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Your name')).toBeTruthy();
  });

  it('keeps the game and confirmation visible when leaving fails', async () => {
    api.leaveGame.mockRejectedValueOnce(new Error('Offline'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Exit game' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Exit' })));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Offline');
    expect(screen.queryByLabelText('Your name')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Exit' })));
    expect(screen.getByLabelText('Your name')).toBeTruthy();
  });

  it('clears the session when New game is selected on results', async () => {
    api.getState.mockResolvedValue({ state: membership('ended') });
    render(<App />);
    await act(async () => {});
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New game' })));
    expect(api.leaveGame).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Your name')).toBeTruthy();
  });
});

describe('exit polling races', () => {
  function Probe() {
    const game = useGame();
    return <>
      <span>{game.state === undefined ? 'loading' : game.state === null ? 'home' : 'playing'}</span>
      <span>{game.reconnecting ? 'reconnecting' : 'connected'}</span>
      <button onClick={() => void game.leave()}>Leave</button>
    </>;
  }

  it.each(['resolve', 'reject'] as const)('ignores a stale poll that later %ss and prevents polling during exit', async (outcome) => {
    vi.useFakeTimers();
    render(<Probe />);
    await act(async () => {});
    const poll = deferred<{ state: GameState }>();
    api.getState.mockReturnValueOnce(poll.promise);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    const leave = deferred<{ state: null }>();
    api.leaveGame.mockReturnValue(leave.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    const calls = api.getState.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    expect(api.getState).toHaveBeenCalledTimes(calls);
    expect(api.leaveGame).toHaveBeenCalledTimes(1);
    await act(async () => leave.resolve({ state: null }));
    await act(async () => {
      if (outcome === 'resolve') poll.resolve({ state: membership() });
      else poll.reject(new Error('old request failed'));
    });
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('resumes state polling after a failed exit', async () => {
    vi.useFakeTimers();
    render(<Probe />);
    await act(async () => {});
    api.leaveGame.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Leave' })));
    const calls = api.getState.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(api.getState.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByText('playing')).toBeTruthy();
  });
});

describe('departure results', () => {
  it('labels departures and retains scores without calling them survivors or caught', () => {
    const state = membership('ended');
    state.game.end_reason = 'players_left';
    state.players[1]!.left_at = 3000;
    render(<Results state={state} busy={false} onNewGame={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Game ended' })).toBeTruthy();
    expect(screen.getByText('Left game')).toBeTruthy();
    expect(screen.getByText('2 tags')).toBeTruthy();
    expect(screen.getByText('Survivors').parentElement?.textContent).toBe('0Survivors');
    expect(screen.queryByText('Caught them all!')).toBeNull();
    expect(screen.queryByText('Survived')).toBeNull();
  });
});
