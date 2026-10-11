// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGameMap } from '../src/hooks/useGameMap';
import { Game } from '../src/views/Game';
import type { MapResponse, GameState } from '../src/types';

// The embedded radar map has its own integration coverage.
vi.mock('../src/components/RadarMap', () => ({ RadarMap: () => null }));

const apiMock = vi.hoisted(() => ({ getMap: vi.fn() }));
vi.mock('../src/api', () => ({ api: apiMock }));
const leaflet = vi.hoisted(() => {
  const map = { remove: vi.fn(), invalidateSize: vi.fn(), fitBounds: vi.fn(), setView: vi.fn(),
    zoomIn: vi.fn(), zoomOut: vi.fn(), hasLayer: vi.fn(() => true) };
  const tiles = { addTo: vi.fn(), on: vi.fn(), redraw: vi.fn() };
  tiles.addTo.mockReturnValue(tiles);
  const markers: Array<Record<string, any>> = [];
  const circles: Array<Record<string, any>> = [];
  return { map, tiles, markers, circles };
});
vi.mock('leaflet', () => ({
  map: () => leaflet.map,
  tileLayer: () => leaflet.tiles,
  control: { scale: () => ({ addTo: vi.fn() }) },
  latLng: (lat: number, lng: number) => ({ toBounds: () => ({ getSouthWest: () => [lat, lng], getNorthEast: () => [lat, lng] }) }),
  latLngBounds: (points: unknown) => points,
  divIcon: (options: unknown) => options,
  marker: () => {
    const marker: Record<string, any> = {};
    for (const method of ['bindTooltip', 'setLatLng', 'setIcon', 'setOpacity', 'addTo', 'remove']) marker[method] = vi.fn(() => marker);
    leaflet.markers.push(marker);
    return marker;
  },
  circle: () => {
    const circle: Record<string, any> = {};
    for (const method of ['addTo', 'setLatLng', 'setRadius', 'setStyle', 'remove']) circle[method] = vi.fn(() => circle);
    leaflet.circles.push(circle);
    return circle;
  },
}));

const at = Date.UTC(2026, 9, 11);
const snapshot = (): MapResponse => ({ server_now: at, snapshot_at: at, unavailable_player_ids: [], points: [
  { player_id: 'me', lat: 1.3, lng: 103.8, accuracy_m: 10, captured_at: at },
  { player_id: 'runner', lat: 1.4, lng: 103.8, accuracy_m: 15, captured_at: at },
] });
const state: GameState = {
  server_now: at,
  me: { player_id: 'me', name: 'Host', role: 'catcher', is_host: true, tag_code: 'ABCDEF', qr_payload: 'tag:ABCDEF:me:secret' },
  game: { code: 'ABCDEF', status: 'active', host_player_id: 'me', created_at: at, started_at: at, ended_at: null, duration_minutes: 30, ends_at: null, end_reason: null },
  players: [
    { id: 'me', name: 'Host', role: 'catcher', is_host: true, gps_ready: true, tag_count: 0, caught_at: null, left_at: null },
    { id: 'runner', name: 'Runner', role: 'runner', is_host: false, gps_ready: true, tag_count: 0, caught_at: null, left_at: null },
  ], events: [],
};
const gameProps = { state, radar: null, radarReconnecting: false, nowMs: at, gpsStatus: 'active' as const, busy: false,
  onEnableGps: vi.fn(), onResetGps: vi.fn(), onTag: vi.fn(), onEnd: vi.fn(), onExit: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  leaflet.markers.length = 0;
  leaflet.circles.length = 0;
  apiMock.getMap.mockReset().mockResolvedValue(snapshot());
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('opens from a separate button, controls the viewport, preserves it during updates and restores focus on close', async () => {
  const view = render(<Game {...gameProps} />);
  expect(apiMock.getMap).not.toHaveBeenCalled();
  const opener = screen.getByRole('button', { name: /^Map$/ });
  opener.focus(); fireEvent.click(opener);
  await screen.findByRole('button', { name: 'Show everyone' });
  await waitFor(() => expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('dialog', { name: 'Game map' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(leaflet.map.zoomIn).toHaveBeenCalledOnce();
  expect(leaflet.map.zoomOut).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'My location' }));
  expect(leaflet.map.setView).toHaveBeenCalledWith([1.3, 103.8], 16, { animate: false });
  fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }));
  expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(2);
  view.rerender(<Game {...gameProps} nowMs={at + 16_000} state={{ ...state, players: state.players.map((p) => ({ ...p, role: 'catcher' })) }} />);
  expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(2);
  expect(leaflet.markers[1]!.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ className: 'map-player catcher aging' }));
  expect(leaflet.markers[1]!.setOpacity).toHaveBeenLastCalledWith(0.55);
  fireEvent.click(screen.getByRole('button', { name: 'Close map' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(leaflet.map.remove).toHaveBeenCalledOnce();
  expect(apiMock.getMap.mock.calls[0]![0].aborted).toBe(true);
});

it('expires markers during an outage and can close with Escape', async () => {
  const view = render(<Game {...gameProps} />);
  fireEvent.click(screen.getByRole('button', { name: /^Map$/ }));
  await waitFor(() => expect(leaflet.markers).toHaveLength(2));
  view.rerender(<Game {...gameProps} nowMs={at + 30_001} />);
  expect(leaflet.markers[0]!.remove).toHaveBeenCalledOnce();
  expect(leaflet.markers[1]!.remove).toHaveBeenCalledOnce();
  expect(screen.getByText('Waiting for fresh GPS locations…')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'My location' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows other players without own GPS and retries failed street tiles', async () => {
  apiMock.getMap.mockResolvedValue({ ...snapshot(), points: snapshot().points.slice(1), unavailable_player_ids: ['me'] });
  render(<Game {...gameProps} gpsStatus="off" />);
  fireEvent.click(screen.getByRole('button', { name: /^Map$/ }));
  await waitFor(() => expect(leaflet.markers).toHaveLength(1));
  expect((screen.getByRole('button', { name: 'My location' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole('button', { name: 'Enable GPS' }).length).toBeGreaterThan(0);
  const callback = leaflet.tiles.on.mock.calls.find(([event]) => event === 'tileerror')![1];
  act(() => callback());
  expect(screen.getByText('Streets could not load. Player locations still update.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry streets' }));
  expect(leaflet.tiles.redraw).toHaveBeenCalledOnce();
});

function Poller({ visible }: { visible: boolean }) {
  const { snapshot: result, reconnecting } = useGameMap(visible);
  return <span>{`${result?.snapshot_at ?? 'loading'}:${reconnecting ? 'retrying' : 'ready'}`}</span>;
}
async function flush() { await act(async () => { await Promise.resolve(); }); }

it('polls at five seconds, retries failures, stops hidden requests and refreshes on return', async () => {
  vi.useFakeTimers();
  const view = render(<Poller visible />);
  await flush();
  expect(apiMock.getMap).toHaveBeenCalledTimes(1);
  apiMock.getMap.mockRejectedValueOnce(new Error('offline'));
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(screen.getByText(`${at}:retrying`)).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(screen.getByText(`${at}:ready`)).toBeTruthy();
  expect(apiMock.getMap).toHaveBeenCalledTimes(3);
  const signal = apiMock.getMap.mock.calls[2]![0];
  view.rerender(<Poller visible={false} />);
  expect(signal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  expect(apiMock.getMap).toHaveBeenCalledTimes(3);
  view.rerender(<Poller visible />);
  await flush();
  expect(apiMock.getMap).toHaveBeenCalledTimes(4);
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(20_000));
  expect(apiMock.getMap).toHaveBeenCalledTimes(4);
});

it('ignores late responses after closing the map', async () => {
  vi.useFakeTimers();
  let resolve!: (response: MapResponse) => void;
  apiMock.getMap.mockImplementation(() => new Promise<MapResponse>((done) => { resolve = done; }));
  const view = render(<Poller visible />);
  view.unmount();
  await act(async () => resolve(snapshot()));
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(apiMock.getMap).toHaveBeenCalledOnce();
});
