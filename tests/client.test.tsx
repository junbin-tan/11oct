// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, viewFor } from '../src/App';
import { PlayerQr } from '../src/components/PlayerQr';
import { Radar, radarPosition } from '../src/components/Radar';
import { useGeolocation } from '../src/hooks/useGeolocation';
import { useGame } from '../src/hooks/useGame';
import { useRadar } from '../src/hooks/useRadar';
import type { GameState, RadarResponse } from '../src/types';
import { GpsStatus } from '../src/views/GpsStatus';

const apiMock = vi.hoisted(() => ({
  getState: vi.fn(),
  getRadar: vi.fn(),
  updateLocation: vi.fn(),
}));

vi.mock('../src/api', () => {
  class ApiError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { api: apiMock, ApiError };
});

const zxing = vi.hoisted(() => ({
  stop: vi.fn(),
  onResult: null as null | ((result: { getText: () => string } | undefined) => void),
  reject: null as null | Error,
}));

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints(_constraints: unknown, _video: unknown, callback: typeof zxing.onResult) {
      zxing.onResult = callback;
      return zxing.reject ? Promise.reject(zxing.reject) : Promise.resolve({ stop: zxing.stop });
    }
  },
}));

const { QrScanner } = await import('../src/components/QrScanner');

function stateWith(status: GameState['game']['status']): GameState {
  return {
    server_now: 0,
    me: { player_id: 'p1', name: 'A', role: 'runner', is_host: false, tag_code: 'AAAAAA', qr_payload: 'tag:X:p1:t' },
    game: { code: 'ABCDEF', status, host_player_id: 'p0', created_at: 0, started_at: null, ended_at: null },
    players: [],
    events: [],
  };
}

describe('viewFor', () => {
  it('maps session state to screens', () => {
    expect(viewFor(undefined)).toBe('loading');
    expect(viewFor(null)).toBe('home');
    expect(viewFor(stateWith('waiting'))).toBe('lobby');
    expect(viewFor(stateWith('active'))).toBe('game');
    expect(viewFor(stateWith('ended'))).toBe('results');
  });
});

describe('radarPosition', () => {
  it('places points north-up with east to the right', () => {
    const centre = radarPosition(0, 0);
    const north = radarPosition(500, 0);
    const east = radarPosition(250, 90);
    const south = radarPosition(500, 180);
    expect(north.x).toBeCloseTo(centre.x);
    expect(north.y).toBeLessThan(centre.y);
    expect(east.x).toBeGreaterThan(centre.x);
    expect(east.y).toBeCloseTo(centre.y);
    expect(south.y).toBeGreaterThan(centre.y);
    expect(radarPosition(2000, 0)).toEqual(north);
  });
});

describe('QrScanner', () => {
  beforeEach(() => {
    zxing.stop.mockReset();
    zxing.onResult = null;
    zxing.reject = null;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
  });

  afterEach(cleanup);

  it('stops the camera when closed', async () => {
    const view = render(<QrScanner onSubmit={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    view.unmount();
    expect(zxing.stop).toHaveBeenCalledTimes(1);
  });

  it('submits a scan once and suppresses repeated reads of the same code', async () => {
    const onSubmit = vi.fn().mockResolvedValue('Nope');
    render(<QrScanner onSubmit={onSubmit} onClose={vi.fn()} />);
    await act(async () => {});
    await act(async () => {
      zxing.onResult!({ getText: () => 'tag:ROOM:p:t' });
    });
    await act(async () => {
      zxing.onResult!({ getText: () => 'tag:ROOM:p:t' });
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ payload: 'tag:ROOM:p:t' });
    expect(await screen.findByText('Nope')).toBeTruthy();
  });

  it('falls back to the manual code when camera permission is denied', async () => {
    zxing.reject = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<QrScanner onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(await screen.findByText(/Camera permission denied/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tag code'), { target: { value: 'abc123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    });
    expect(onSubmit).toHaveBeenCalledWith({ code: 'ABC123' });
  });
});

describe('native dialogs', () => {
  afterEach(cleanup);

  function DialogHarness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Show my QR</button>
        {open && <PlayerQr name="Ada" payload="tag:ROOM:p:t" tagCode="ABC123" onClose={() => setOpen(false)} />}
      </>
    );
  }

  it('closes on cancel and restores focus to its opener', () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Show my QR' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'My tag QR' });
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));

    expect(screen.queryByRole('dialog', { name: 'My tag QR' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

function membership(status: GameState['game']['status'], code = 'ABCDEF'): GameState {
  return {
    ...stateWith(status),
    server_now: 1_000,
    game: { ...stateWith(status).game, code },
    players: [
      {
        id: 'p1',
        name: 'Ada',
        role: 'catcher',
        is_host: true,
        gps_ready: false,
        tag_count: 0,
        caught_at: null,
      },
    ],
  };
}

describe('session recovery', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    apiMock.getState.mockReset();
    window.history.replaceState(null, '', '/');
  });

  function StatusProbe() {
    const game = useGame();
    const label = game.state === undefined ? 'loading' : game.state === null ? 'home' : game.state.game.code;
    return <div>{`${label}${game.reconnecting ? ' reconnecting' : ''}`}</div>;
  }

  it('retries a failed restore instead of showing the home screen', async () => {
    vi.useFakeTimers();
    apiMock.getState.mockRejectedValueOnce(new Error('offline'));
    apiMock.getState.mockResolvedValueOnce({ state: null });
    render(<StatusProbe />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('loading reconnecting')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText('home')).toBeTruthy();
    expect(apiMock.getState).toHaveBeenCalledTimes(2);
  });

  it('keeps the last confirmed game when a later refresh fails', async () => {
    vi.useFakeTimers();
    apiMock.getState.mockResolvedValueOnce({ state: membership('active', 'LIVE01') });
    apiMock.getState.mockRejectedValue(new Error('offline'));
    render(<StatusProbe />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/LIVE01/)).toBeTruthy();
    expect(screen.queryByText('home')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText('LIVE01 reconnecting')).toBeTruthy();
  });

  it('keeps a live game open when another invite is opened', async () => {
    window.history.replaceState(null, '', '/?room=JOINME');
    apiMock.getState.mockResolvedValue({ state: membership('waiting', 'LIVE01') });
    render(<App />);
    expect(await screen.findByText('Finish this game before joining JOINME.')).toBeTruthy();
    expect(screen.getByText('LIVE01')).toBeTruthy();
    expect(apiMock.getState).toHaveBeenCalled();
  });

  it('returns to the invite after the current game has ended', async () => {
    window.history.replaceState(null, '', '/?room=JOINME');
    apiMock.getState.mockResolvedValue({ state: membership('ended', 'LIVE01') });
    render(<App />);
    expect(await screen.findByLabelText('Room code')).toBeTruthy();
    expect(screen.queryByText('LIVE01')).toBeNull();
    expect((screen.getByLabelText('Room code') as HTMLInputElement).value).toBe('JOINME');
  });
});

describe('useRadar lifecycle', () => {
  const waiting: RadarResponse = {
    origin_available: false,
    origin_captured_at: null,
    origin_accuracy_m: null,
    snapshot_at: null,
    next_ping_at: null,
    server_now: 1_000,
    points: [],
    missing_gps_count: 0,
    outside_range_count: 0,
  };

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    apiMock.getRadar.mockReset();
  });

  function RadarProbe({ active, visible }: { active: boolean; visible: boolean }) {
    useRadar(active, visible, () => 1_000, false);
    return null;
  }

  it('does not schedule another fetch after an in-flight request is cancelled', async () => {
    vi.useFakeTimers();
    let resolveRadar: (value: RadarResponse) => void = () => {};
    apiMock.getRadar.mockImplementation(() => new Promise<RadarResponse>((resolve) => {
      resolveRadar = resolve;
    }));
    const view = render(<RadarProbe active visible />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(apiMock.getRadar).toHaveBeenCalledTimes(1);
    view.rerender(<RadarProbe active={false} visible />);
    await act(async () => {
      resolveRadar(waiting);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(apiMock.getRadar).toHaveBeenCalledTimes(1);
  });
});

describe('foreground location delivery', () => {
  let reports: PositionCallback[];
  let errors: PositionErrorCallback[];
  let acquire: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;
  const sample = (lat = 1.3, timestamp = Date.now(), accuracy = 5) => ({
    coords: { latitude: lat, longitude: 103.8, accuracy }, timestamp,
  }) as GeolocationPosition;
  const ack = (accepted = true, reason = 'accepted', next = Date.now() + 5_000) => ({
    accepted, reason, server_now: Date.now(), next_upload_at: next,
  });
  function Probe({ sharing = true, visible = true, offset = 0 }: { sharing?: boolean; visible?: boolean; offset?: number }) {
    const gps = useGeolocation(sharing, visible, () => Date.now() + offset);
    return <>
      <span data-testid="gps-state">{`${gps.status}:${gps.fix ? 'fixed' : 'empty'}`}</span>
      <button onClick={gps.enable}>Enable</button><button onClick={gps.reset}>Reset</button>
    </>;
  }
  const status = () => screen.getByTestId('gps-state').textContent;
  const advance = async (ms: number) => { await act(async () => vi.advanceTimersByTimeAsync(ms)); };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
    reports = []; errors = []; acquire = vi.fn(); clearWatch = vi.fn();
    apiMock.updateLocation.mockReset().mockImplementation(() => Promise.resolve(ack()));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition: (success: PositionCallback, error: PositionErrorCallback, options: PositionOptions) => {
        expect(options).toMatchObject({ maximumAge: 0, enableHighAccuracy: true });
        reports.push(success); errors.push(error); return reports.length;
      }, getCurrentPosition: acquire, clearWatch,
    } });
    Object.defineProperty(navigator, 'permissions', { configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) } });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); apiMock.updateLocation.mockReset(); });
  const start = (props = {}) => {
    const view = render(<Probe {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    return view;
  };

  it('preserves capture age and normalizes device clock before upload', async () => {
    start({ offset: 90_000 });
    const timestamp = Date.now() - 4_000;
    await act(async () => reports[0]!(sample(1.3, timestamp)));
    expect(apiMock.updateLocation).toHaveBeenCalledWith(1.3, 103.8, 5, timestamp + 90_000, expect.any(AbortSignal));
    expect(status()).toBe('active:fixed');
  });

  it('waits for acknowledgement before reporting shared', async () => {
    let resolve!: (value: ReturnType<typeof ack>) => void;
    apiMock.updateLocation.mockImplementation(() => new Promise((r) => { resolve = r; }));
    start();
    await act(async () => reports[0]!(sample()));
    expect(status()).toBe('sharing:fixed');
    await act(async () => resolve(ack()));
    expect(status()).toBe('active:fixed');
  });

  it('serializes slow uploads and keeps only the latest pending sample', async () => {
    let resolve!: (value: ReturnType<typeof ack>) => void;
    apiMock.updateLocation.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    start();
    await act(async () => reports[0]!(sample()));
    await advance(6_000);
    await act(async () => reports[0]!(sample(1.31)));
    await advance(1_000);
    await act(async () => reports[0]!(sample(1.32)));
    expect(apiMock.updateLocation).toHaveBeenCalledTimes(1);
    await act(async () => resolve(ack(true, 'accepted', Date.now())));
    await advance(1_000);
    expect(apiMock.updateLocation).toHaveBeenCalledTimes(2);
    expect(apiMock.updateLocation.mock.calls[1]![0]).toBe(1.32);
  });

  it('throttles fast sensor callbacks to five seconds and ignores duplicates', async () => {
    start(); const first = sample();
    await act(async () => reports[0]!(first));
    await advance(1_000);
    await act(async () => reports[0]!(sample(1.31)));
    await advance(3_000);
    await act(async () => reports[0]!(first));
    expect(apiMock.updateLocation).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(apiMock.updateLocation).toHaveBeenCalledTimes(2);
    expect(apiMock.updateLocation.mock.calls[1]![0]).toBe(1.31);
  });

  it('honors the server throttle acknowledgement', async () => {
    apiMock.updateLocation.mockImplementationOnce(() => Promise.resolve(ack(false, 'throttled', Date.now() + 8_000)));
    start(); await act(async () => reports[0]!(sample()));
    expect(status()).toBe('sharing:fixed');
    await advance(7_000); expect(apiMock.updateLocation).toHaveBeenCalledTimes(1);
    await advance(1_000); expect(apiMock.updateLocation).toHaveBeenCalledTimes(2);
    expect(status()).toBe('active:fixed');
  });

  it.each(['older', 'expired', 'future'])('does not report a %s rejection as shared', async (reason) => {
    apiMock.updateLocation.mockImplementationOnce(() => Promise.resolve(ack(false, reason)));
    start(); await act(async () => reports[0]!(sample()));
    expect(status()).toBe('unavailable:fixed');
    await advance(10_000); expect(apiMock.updateLocation).toHaveBeenCalledTimes(1);
  });

  it('reports an upload outage and retries the newest reading', async () => {
    apiMock.updateLocation.mockRejectedValueOnce(new Error('offline'));
    start(); await act(async () => reports[0]!(sample()));
    expect(status()).toBe('connection_lost:fixed');
    await advance(2_000); await act(async () => reports[0]!(sample(1.31)));
    await advance(3_000);
    expect(apiMock.updateLocation.mock.calls[1]![0]).toBe(1.31);
    expect(status()).toBe('active:fixed');
  });

  it('ages stationary readings and requests a fresh acquisition only once while pending', async () => {
    start(); const first = sample();
    await act(async () => reports[0]!(first));
    await advance(16_000);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire.mock.calls[0]![2]).toMatchObject({ maximumAge: 0 });
    expect(status()).toBe('aging:fixed');
    await advance(15_000);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(status()).toBe('unavailable:fixed');
    await act(async () => acquire.mock.calls[0]![0](first));
    expect(apiMock.updateLocation).toHaveBeenCalledTimes(1);
  });

  it('aborts uploads on hide, ignores late callbacks, and starts a fresh watch on return', async () => {
    apiMock.updateLocation.mockImplementationOnce(() => new Promise(() => {}));
    const view = start();
    await act(async () => reports[0]!(sample()));
    const signal = apiMock.updateLocation.mock.calls[0]![4] as AbortSignal;
    view.rerender(<Probe visible={false} />);
    expect(signal.aborted).toBe(true); expect(clearWatch).toHaveBeenCalledWith(1);
    expect(status()).toBe('paused:empty');
    await advance(6_000); await act(async () => reports[0]!(sample()));
    expect(apiMock.updateLocation).toHaveBeenCalledTimes(1);
    view.rerender(<Probe visible />);
    expect(reports).toHaveLength(2);
    await act(async () => reports[1]!(sample()));
    expect(status()).toBe('active:fixed');
  });

  it('clears the fix on reset and rejects callbacks from the old watch', async () => {
    start(); await act(async () => reports[0]!(sample()));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(status()).toBe('requesting:empty');
    expect(clearWatch).toHaveBeenCalledWith(1);
    await advance(5_000); await act(async () => reports[0]!(sample()));
    expect(apiMock.updateLocation).toHaveBeenCalledTimes(1);
    await act(async () => reports[1]!(sample()));
    expect(status()).toBe('active:fixed');
  });

  it('stops on game end and ignores late sensor callbacks', async () => {
    const view = start(); view.rerender(<Probe sharing={false} />);
    await act(async () => reports[0]!(sample()));
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(apiMock.updateLocation).not.toHaveBeenCalled();
    expect(status()).toBe('off:empty');
  });

  it('stops sharing when sensor permission is denied', async () => {
    start();
    await act(async () => errors[0]!({ code: 1 } as GeolocationPositionError));
    expect(status()).toBe('denied:empty');
    await act(async () => reports[0]!(sample()));
    await advance(30_000);
    expect(apiMock.updateLocation).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled();
  });

  it('reports poor accuracy even after a successful upload', async () => {
    start(); await act(async () => reports[0]!(sample(1.3, Date.now(), 120)));
    expect(status()).toBe('poor:fixed');
  });
});

describe('GpsStatus recovery actions', () => {
  afterEach(cleanup);

  it('offers cache clearing only when GPS is denied or unavailable', () => {
    const onEnable = vi.fn();
    const onResetGps = vi.fn();
    const view = render(<GpsStatus status="denied" onEnable={onEnable} onResetGps={onResetGps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear GPS cache' }));
    expect(onResetGps).toHaveBeenCalledTimes(1);

    view.rerender(<GpsStatus status="unavailable" onEnable={onEnable} onResetGps={onResetGps} />);
    expect(screen.getByRole('button', { name: 'Clear GPS cache' })).toBeTruthy();

    for (const status of ['off', 'requesting', 'active', 'unsupported'] as const) {
      view.rerender(<GpsStatus status={status} onEnable={onEnable} onResetGps={onResetGps} />);
      expect(screen.queryByRole('button', { name: 'Clear GPS cache' })).toBeNull();
    }
  });
});

describe('radar freshness and uncertainty display', () => {
  afterEach(cleanup);
  const at = 1_000_000;
  const player = { id: 'p2', name: 'Bob', role: 'runner' as const, is_host: false, gps_ready: true, tag_count: 0, caught_at: null };
  const snapshot = (): RadarResponse => ({
    origin_available: true, origin_captured_at: at, origin_accuracy_m: 15,
    snapshot_at: at, next_ping_at: at + 5000, server_now: at, missing_gps_count: 0, outside_range_count: 0,
    points: [{ player_id: 'p2', distance_m: 150, bearing_deg: 90, accuracy_m: 5,
      captured_at: at, fix_age_s: 0, uncertainty_m: 20, position_uncertain: false }],
  });
  it('shows combined uncertainty and ages the reading during a network outage', () => {
    const radar = snapshot();
    const view = render(<Radar radar={radar} players={[player]} nowMs={at} />);
    expect(screen.getByText(/≈ 150 m \(±20 m\)/)).toBeTruthy();
    expect(view.container.querySelector('.radar-uncertainty')).not.toBeNull();
    view.rerender(<Radar radar={radar} players={[player]} nowMs={at + 16_000} reconnecting />);
    expect(screen.getByText(/16s old · aging/)).toBeTruthy();
    expect(screen.getByText('Connection lost. Retrying radar…')).toBeTruthy();
    expect(view.container.querySelector('.radar-aging')).not.toBeNull();
    view.rerender(<Radar radar={radar} players={[player]} nowMs={at + 30_001} reconnecting />);
    expect(view.container.querySelector('.radar-dot')).toBeNull();
    expect(screen.getByText(/Location expired/)).toBeTruthy();
    expect(screen.queryByText(/≈ 150 m/)).toBeNull();
  });
  it('hides directions when only the origin has expired', () => {
    const radar = snapshot(); radar.points[0]!.captured_at = at + 25_000;
    const view = render(<Radar radar={radar} players={[player]} nowMs={at + 31_000} />);
    expect(view.container.querySelector('.radar-dot')).toBeNull();
    expect(screen.getByText(/Your location expired/)).toBeTruthy();
  });
  it.each(['overlap', 'unknown accuracy', 'unknown capture age', 'unknown origin age'])(
    'does not plot %s as a precise position', (scenario) => {
      const radar = snapshot();
      if (scenario === 'overlap') radar.points[0]!.position_uncertain = true;
      if (scenario === 'unknown accuracy') radar.points[0]!.uncertainty_m = null;
      if (scenario === 'unknown capture age') radar.points[0]!.captured_at = null;
      if (scenario === 'unknown origin age') radar.origin_captured_at = null;
      const view = render(<Radar radar={radar} players={[player]} nowMs={at} />);
      expect(view.container.querySelector('.radar-dot')).toBeNull();
      expect(screen.getByText(/Position uncertain/)).toBeTruthy();
      expect(screen.queryByText(/≈ 150 m/)).toBeNull();
    },
  );
});

describe('radar refresh recovery', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); apiMock.getRadar.mockReset(); });
  function Probe() {
    const { radar, reconnecting } = useRadar(true, true, Date.now, false);
    return <span>{`${radar?.snapshot_at ?? 'none'}:${reconnecting ? 'retrying' : 'ready'}`}</span>;
  }
  it('refreshes on the five-second deadline and exposes errors while retaining the last snapshot', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    apiMock.getRadar.mockResolvedValueOnce({ snapshot_at: Date.now(), next_ping_at: Date.now() + 5_000, origin_available: true });
    apiMock.getRadar.mockRejectedValueOnce(new Error('offline'));
    apiMock.getRadar.mockResolvedValue({ snapshot_at: 1_015_250, next_ping_at: 1_020_250, origin_available: true });
    render(<Probe />);
    await act(async () => {});
    expect(screen.getByText('1000000:ready')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(5_250));
    expect(screen.getByText('1000000:retrying')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByText('1015250:ready')).toBeTruthy();
  });
});
