import { useCallback, useEffect, useRef, useState } from 'react';
import type { CtfState } from '../../server/ctf/types';
import { ctfRequest, type StateResponse } from './api';

export function useCtf() {
  const [state, setState] = useState<CtfState | null>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsMessage, setGpsMessage] = useState('Enable GPS to join the play area.');
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0), generation = useRef(0), mutation = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    const listener = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', listener);
    const timer = setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', listener); };
  }, []);
  const apply = useCallback((result: StateResponse, sent: number) => {
    const serverNow = result.state?.server_now ?? result.server_now;
    if (serverNow !== undefined) offset.current = serverNow - (sent + Date.now()) / 2;
    setState(result.state); setConnected(true);
  }, []);
  const status = state === undefined ? 'loading' : state?.game.status ?? 'home';
  useEffect(() => {
    if (!visible || status === 'ended' || status === 'home') return;
    let cancelled = false, inFlight = false;
    const controller = new AbortController();
    const poll = async () => {
      if (mutation.current || inFlight) return;
      inFlight = true;
      const seq = generation.current, sent = Date.now();
      try {
        const result = await ctfRequest<StateResponse>('state', 'GET', undefined, controller.signal);
        if (!cancelled && seq === generation.current) apply(result, sent);
      } catch { if (!cancelled && seq === generation.current) setConnected(false); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3_000);
    return () => { cancelled = true; clearInterval(timer); controller.abort(); };
  }, [status, visible, apply]);

  const run = useCallback(async (path: string, body?: unknown, method = 'POST'): Promise<StateResponse | null> => {
    if (mutation.current) return null;
    mutation.current = true; generation.current++; setBusy(true); setError('');
    const sent = Date.now();
    try {
      const result = await ctfRequest<StateResponse>(path, method, body);
      if (mounted.current) apply(result, sent);
      return result;
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Request failed.'); return null; }
    finally { mutation.current = false; if (mounted.current) setBusy(false); }
  }, [apply]);

  const playerId = state?.me.id;
  useEffect(() => {
    if (!gpsEnabled || !visible || !playerId || (status !== 'waiting' && status !== 'active')) return;
    if (!navigator.geolocation) { setGpsMessage('This browser does not support GPS.'); setGpsEnabled(false); return; }
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const schedule = () => { if (!cancelled) timer = setTimeout(locate, 5_000); };
    const locate = () => {
      if (cancelled) return;
      navigator.geolocation.getCurrentPosition(async fix => {
        if (cancelled) return;
        try {
          const result = await ctfRequest<{ accepted: boolean; reason: string }>('location', 'PUT', {
            lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy,
            captured_at: Math.round(Math.min(Date.now(), fix.timestamp) + offset.current),
          }, controller.signal);
          if (!cancelled) setGpsMessage(!result.accepted ? 'Waiting for a fresh GPS reading…'
            : fix.coords.accuracy > 15 ? `GPS accuracy is ${Math.round(fix.coords.accuracy)} m. Move into clearer view of the sky.` : `GPS ready · ±${Math.round(fix.coords.accuracy)} m`);
        } catch { if (!cancelled) setGpsMessage('GPS upload interrupted. Capture progress needs a connection.'); }
        schedule();
      }, error => {
        if (cancelled) return;
        setGpsMessage(error.code === 1 ? 'Location permission denied. Allow it in browser settings, then enable GPS again.' : 'Waiting for GPS. Stay outdoors with the app open.');
        if (error.code === 1) setGpsEnabled(false); else schedule();
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 });
    };
    locate();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [gpsEnabled, visible, playerId, status]);

  return { state, run, busy, error, setError, connected, now, gpsEnabled, gpsMessage, visible,
    enableGps: () => { setGpsMessage('Finding your location…'); setGpsEnabled(true); } };
}
