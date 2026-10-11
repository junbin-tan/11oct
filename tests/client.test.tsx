// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, viewFor } from '../src/App';
import { radarPosition } from '../src/components/Radar';
import { useGeolocation } from '../src/hooks/useGeolocation';
import { useGame } from '../src/hooks/useGame';
import { useRadar } from '../src/hooks/useRadar';
import type { GameState, RadarResponse } from '../src/types';

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

describe('useGeolocation cleanup', () => {
  afterEach(() => {
    cleanup();
    apiMock.updateLocation.mockReset();
  });

  function GpsProbe({ sharing }: { sharing: boolean }) {
    const gps = useGeolocation(sharing, true);
    return <button onClick={gps.enable}>Enable</button>;
  }

  it('ignores a position callback that arrives after tracking stops', async () => {
    let report: PositionCallback = () => {};
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          report = success;
        },
      },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
    });

    const view = render(<GpsProbe sharing />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    view.rerender(<GpsProbe sharing={false} />);
    report({
      coords: { latitude: 1.3, longitude: 103.8, accuracy: 5 },
    } as GeolocationPosition);
    expect(apiMock.updateLocation).not.toHaveBeenCalled();
  });
});
