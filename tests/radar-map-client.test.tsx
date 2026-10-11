// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as L from 'leaflet';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapCanvas, radarMapPoints } from '../src/components/MapCanvas';
import { RadarMap } from '../src/components/RadarMap';
import { Game } from '../src/views/Game';
import type { MapPlayer } from '../src/components/GameMap';
import type { GameState, MapResponse } from '../src/types';

const api = vi.hoisted(() => ({ getMap: vi.fn() }));
vi.mock('../src/api', () => ({ api }));

const at = 1_000_000;
const me: MapPlayer = { player_id: 'me', lat: 1.3, lng: 103.8, accuracy_m: 10, captured_at: at,
  name: 'Host', role: 'catcher', isMe: true, aging: false };
const runner: MapPlayer = { ...me, player_id: 'runner', lat: 1.301, name: 'Runner', role: 'runner', isMe: false };
const state: GameState = {
  server_now: at,
  me: { player_id: 'me', name: 'Host', role: 'catcher', is_host: true, tag_code: 'ABCDEF', qr_payload: 'tag:ABCDEF:me:secret' },
  game: { code: 'ABCDEF', status: 'active', host_player_id: 'me', created_at: at, started_at: at, ended_at: null,
    duration_minutes: 30, ends_at: at + 1_800_000, end_reason: null },
  players: [me, runner].map((p) => ({ id: p.player_id, name: p.name, role: p.role, is_host: p.isMe,
    gps_ready: true, tag_count: 0, caught_at: null, left_at: null })), events: [],
};
const snapshot = (points = [me, runner]): MapResponse => ({ server_now: at, snapshot_at: at, points, unavailable_player_ids: [] });
const props = { players: state.players, myId: 'me', nowMs: at, visible: true };
const svgSupport = L.Browser.svg;
const transformSupport = L.Browser.any3d;
let width = 300;
let resizes: Array<() => void>;
let maps: L.Map[];
let tiles: L.TileLayer[];

beforeEach(() => {
  width = 300; resizes = []; maps = []; tiles = [];
  api.getMap.mockReset().mockResolvedValue(snapshot());
  // Use real Leaflet projection, markers, and controls with deterministic DOM dimensions.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => width);
  Object.assign(L.Browser, { svg: true, any3d: true });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizes.push(callback); }
    observe() {} disconnect() {}
  });
  const setView = L.Map.prototype.setView;
  vi.spyOn(L.Map.prototype, 'setView').mockImplementation(function (this: L.Map, ...args: Parameters<L.Map['setView']>) {
    if (!maps.includes(this)) maps.push(this);
    return setView.apply(this, args);
  });
  const onAdd = L.TileLayer.prototype.onAdd;
  vi.spyOn(L.TileLayer.prototype, 'onAdd').mockImplementation(function (this: L.TileLayer, map: L.Map) {
    tiles.push(this);
    return onAdd.call(this, map);
  });
});
afterEach(() => { cleanup(); Object.assign(L.Browser, { svg: svgSupport, any3d: transformSupport });
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function expectRadius(map: L.Map, origin: MapPlayer) {
  expect(map.getCenter().lat).toBeCloseTo(origin.lat, 5);
  expect(map.getCenter().lng).toBeCloseTo(origin.lng, 5);
  const edge = map.containerPointToLatLng([width, width / 2]);
  // Leaflet rounds the projected center to a pixel (at most ~2 m at this size).
  expect(Math.abs(L.latLng(origin.lat, origin.lng).distanceTo(edge) - 500)).toBeLessThan(3);
}

it('includes the 500 m boundary and excludes locations beyond it or without an origin', () => {
  const origin = { ...me, lat: 0, lng: 0 };
  const atDistance = (distance: number) => ({ ...runner, lng: distance / 6_371_000 * 180 / Math.PI, lat: 0 });
  expect(radarMapPoints([origin, atDistance(499.99)])).toHaveLength(2);
  expect(radarMapPoints([origin, atDistance(500)])).toHaveLength(2);
  expect(radarMapPoints([origin, atDistance(500.01)])).toHaveLength(1);
  expect(radarMapPoints([runner])).toEqual([]);
});

it('keeps a north-up 500 m radius while following location changes and resizing', () => {
  const view = render(<MapCanvas points={[me, runner, { ...runner, player_id: 'far', lat: 1.4 }]} mode="radar" />);
  const map = maps[0]!;
  expectRadius(map, me);
  expect(view.container.querySelectorAll('.map-player')).toHaveLength(2);
  expect(view.container.querySelector('.map-player.catcher.me')).toBeTruthy();
  expect(view.container.querySelector('.map-player.runner')).toBeTruthy();
  expect(screen.getByText('You · Catcher')).toBeTruthy();
  expect(screen.getByText('Runner · Runner')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toBeTruthy();
  for (const handler of [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard]) {
    expect(handler.enabled()).toBe(false);
  }
  expect(screen.queryByLabelText('Map controls')).toBeNull();
  expect(map.latLngToContainerPoint([me.lat + .001, me.lng]).y).toBeLessThan(width / 2);
  expect(map.latLngToContainerPoint([me.lat, me.lng + .001]).x).toBeGreaterThan(width / 2);
  width = 240;
  act(() => resizes[0]!());
  expectRadius(map, me);
  const moved = { ...me, lat: 1.302, lng: 103.802 };
  view.rerender(<MapCanvas points={[moved, runner]} mode="radar" />);
  expectRadius(map, moved);
  expect(view.container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(2);
});

it('shows waiting states, excludes departed players, ages markers, and removes them when own GPS expires', async () => {
  let resolve!: (response: MapResponse) => void;
  api.getMap.mockImplementationOnce(() => new Promise<MapResponse>((done) => { resolve = done; }));
  const view = render(<RadarMap {...props} />);
  expect(screen.getByText('Loading player locations…')).toBeTruthy();
  await act(async () => resolve(snapshot()));
  await waitFor(() => expect(view.container.querySelectorAll('.map-player')).toHaveLength(2));
  view.rerender(<RadarMap {...props} nowMs={at + 16_000} />);
  expect(view.container.querySelectorAll('.map-player.aging')).toHaveLength(2);
  expect((view.container.querySelector('.map-player.runner') as HTMLElement).style.opacity).toBe('0.55');
  view.rerender(<RadarMap {...props} players={props.players.map((p) => p.id === 'runner' ? { ...p, left_at: at } : p)} />);
  expect(view.container.querySelectorAll('.map-player')).toHaveLength(1);
  view.rerender(<RadarMap {...props} nowMs={at + 30_001} />);
  expect(view.container.querySelector('.map-player')).toBeNull();
  expect(screen.getByText('Waiting for your fresh GPS location…')).toBeTruthy();
});

it('waits for your location even if other players have GPS, and recovers on refresh', async () => {
  vi.useFakeTimers();
  api.getMap.mockResolvedValueOnce(snapshot([runner]));
  const view = render(<RadarMap {...props} />);
  await act(async () => {});
  expect(screen.getByText('Waiting for your fresh GPS location…')).toBeTruthy();
  expect(view.container.querySelector('.street-map')).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(view.container.querySelectorAll('.map-player')).toHaveLength(2);
});

it('keeps players visible during tile failures and retries streets inside the radar', async () => {
  const view = render(<RadarMap {...props} />);
  await waitFor(() => expect(tiles).toHaveLength(1));
  const redraw = vi.spyOn(tiles[0]!, 'redraw');
  act(() => { tiles[0]!.fire('tileerror'); });
  expect(screen.getByText('Streets could not load. Player locations still update.')).toBeTruthy();
  expect(view.container.querySelectorAll('.map-player')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Retry streets' }));
  expect(redraw).toHaveBeenCalledOnce();
});

it('expires remote markers during an outage even when your location is still fresh', async () => {
  vi.useFakeTimers();
  api.getMap.mockResolvedValue(snapshot([{ ...me, captured_at: at + 20_000 }, runner]));
  const view = render(<RadarMap {...props} nowMs={at + 20_000} />);
  await act(async () => {});
  api.getMap.mockRejectedValue(new Error('offline'));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(screen.getByText('Connection lost. Retrying map…')).toBeTruthy();
  view.rerender(<RadarMap {...props} nowMs={at + 30_001} />);
  expect(view.container.querySelectorAll('.map-player')).toHaveLength(1);
  expect(view.container.querySelector('.map-player.runner')).toBeNull();
});

it('stops radar map polling when hidden and at the round deadline', async () => {
  vi.useFakeTimers();
  // No GPS needed to verify request lifecycle through the actual game screen.
  api.getMap.mockResolvedValue(snapshot([]));
  const gameProps = { state, radar: null, radarReconnecting: false, nowMs: at, gpsStatus: 'active' as const,
    busy: false, onEnableGps: vi.fn(), onResetGps: vi.fn(), onTag: vi.fn(), onEnd: vi.fn(), onExit: vi.fn() };
  const view = render(<Game {...gameProps} />);
  await act(async () => {});
  expect(api.getMap).toHaveBeenCalledOnce();
  const signal = api.getMap.mock.calls[0]![0];
  view.rerender(<Game {...gameProps} visible={false} />);
  expect(signal.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(api.getMap).toHaveBeenCalledOnce();
  view.rerender(<Game {...gameProps} visible />);
  await act(async () => {});
  expect(api.getMap).toHaveBeenCalledTimes(2);
  view.rerender(<Game {...gameProps} nowMs={state.game.ends_at!} />);
  expect(api.getMap.mock.calls[1]![0].aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(api.getMap).toHaveBeenCalledTimes(2);
});

it('keeps the separate full map interactive and showing distant players', async () => {
  api.getMap.mockResolvedValue(snapshot([me, { ...runner, lat: 1.4 }]));
  render(<Game state={state} radar={null} radarReconnecting={false} nowMs={at} gpsStatus="active"
    busy={false} onEnableGps={vi.fn()} onResetGps={vi.fn()} onTag={vi.fn()} onEnd={vi.fn()} onExit={vi.fn()} />);
  await waitFor(() => expect(maps).toHaveLength(1));
  expect(document.querySelectorAll('.radar-map .map-player')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^Map$/ }));
  const dialog = screen.getByRole('dialog', { name: 'Game map' });
  await waitFor(() => expect(dialog.querySelectorAll('.map-player')).toHaveLength(2));
  expect(maps[1]!.dragging.enabled()).toBe(true);
  expect(within(dialog).getByRole('button', { name: 'Show everyone' })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close map' }));
  expect(document.querySelectorAll('.radar-map .map-player')).toHaveLength(1);
});
