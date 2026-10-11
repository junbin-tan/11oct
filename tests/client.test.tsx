// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewFor } from '../src/App';
import { radarPosition } from '../src/components/Radar';
import type { GameState } from '../src/types';

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
