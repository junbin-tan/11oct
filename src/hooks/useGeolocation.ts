import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { browserLocationProvider, type LocationProvider, type LocationReading } from '../location/provider';

export const GPS_INTERVAL_MS = 5_000;
const FRESH_MS = 15_000;
const EXPIRES_MS = 30_000;

export type GpsStatus = 'off' | 'requesting' | 'sharing' | 'active' | 'aging' | 'poor' |
  'connection_lost' | 'paused' | 'denied' | 'unavailable' | 'unsupported';
export interface Fix { lat: number; lng: number; accuracy: number | null; at: number }

/** Foreground sensor feed with a serialized, latest-only delivery queue. */
export function useGeolocation(
  sharing: boolean,
  visible: boolean,
  serverNow: () => number = Date.now,
  provider: LocationProvider = browserLocationProvider,
) {
  const supported = provider.supported();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<GpsStatus>(supported ? 'off' : 'unsupported');
  const [fix, setFix] = useState<Fix | null>(null);
  const [sharedAt, setSharedAt] = useState<number | null>(null);
  const [request, setRequest] = useState(0);
  const generation = useRef(0);
  const nextAttempt = useRef(0);
  const nowRef = useRef(serverNow);
  nowRef.current = serverNow;

  const enable = useCallback(() => {
    if (!supported) return;
    generation.current++;
    setEnabled(true);
    setRequest((n) => n + 1);
  }, [supported]);
  const reset = enable;

  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return;
    let cancelled = false;
    let permission: PermissionStatus | undefined;
    const changed = () => {
      if (cancelled) return;
      // Granting the prompt may happen during an existing watch; do not restart it.
      if (permission?.state === 'granted') setEnabled(true);
      if (permission?.state === 'denied') {
        generation.current++;
        setEnabled(false);
        setStatus('denied');
      }
    };
    navigator.permissions.query({ name: 'geolocation' }).then((result) => {
      if (cancelled) return;
      permission = result;
      permission.addEventListener?.('change', changed);
      changed();
    }).catch(() => {});
    return () => { cancelled = true; permission?.removeEventListener?.('change', changed); };
  }, [supported]);

  useEffect(() => {
    setFix(null);
    setSharedAt(null);
    if (!supported || !enabled) return;
    if (!sharing || !visible) { setStatus(sharing ? 'paused' : 'off'); return; }
    const gen = ++generation.current;
    const controller = new AbortController();
    const live = () => gen === generation.current && !controller.signal.aborted;
    let stopWatch = () => {};
    let latest: (Fix & { sensorAt: number }) | null = null;
    let pending: Fix | null = null;
    let inFlight = false;
    let lastAck: Fix | null = null;
    let sensorError: 'denied' | 'unavailable' | null = null;
    let disconnected = false;
    let acquireInFlight = false;
    let lastAcquisition = Date.now();
    setStatus('requesting');

    const showStatus = () => {
      if (!live()) return;
      const now = nowRef.current();
      if (sensorError === 'denied') setStatus('denied');
      else if (disconnected) setStatus('connection_lost');
      else if (sensorError) setStatus(sensorError);
      else if (!latest) setStatus(sensorError ?? 'requesting');
      else if (now - latest.at > EXPIRES_MS) setStatus('unavailable');
      else if (!lastAck) setStatus(sensorError ?? 'sharing');
      else if (now - lastAck.at > EXPIRES_MS) setStatus('unavailable');
      else if (latest.accuracy === null || latest.accuracy > 50) setStatus('poor');
      else if (now - lastAck.at > FRESH_MS) setStatus('aging');
      else setStatus('active');
    };

    const pump = async () => {
      if (!live() || inFlight || !pending || Date.now() < nextAttempt.current || sensorError === 'denied') return;
      const sample = pending;
      pending = null;
      if (nowRef.current() - sample.at > EXPIRES_MS) { showStatus(); return; }
      inFlight = true;
      nextAttempt.current = Date.now() + GPS_INTERVAL_MS;
      try {
        const ack = await api.updateLocation(sample.lat, sample.lng, sample.accuracy, sample.at, controller.signal);
        if (!live()) return;
        nextAttempt.current = Math.max(nextAttempt.current, Date.now() + Math.max(0, ack.next_upload_at - ack.server_now));
        disconnected = false;
        if (ack.accepted) {
          sensorError = null;
          lastAck = sample;
          setSharedAt(sample.at);
        } else if (ack.reason === 'throttled') {
          pending ??= sample;
        } else {
          // A refused sample is not shared. Wait for a newer sensor sample.
          sensorError = 'unavailable';
        }
      } catch (error) {
        if (!live()) return;
        if (error instanceof ApiError && (error.code === 'GAME_NOT_ACTIVE' || error.code === 'NOT_IN_ROOM')) {
          stopWatch();
          controller.abort();
          setFix(null);
          setSharedAt(null);
          setStatus('off');
          return;
        }
        disconnected = true;
        pending ??= sample;
      } finally {
        inFlight = false;
        showStatus();
      }
    };

    const onReading = (reading: LocationReading) => {
      if (!live() || sensorError === 'denied') return;
      const age = Date.now() - reading.capturedAt;
      if (!Number.isFinite(reading.capturedAt) || age > EXPIRES_MS || age < -5_000 ||
        !Number.isFinite(reading.lat) || !Number.isFinite(reading.lng) ||
        Math.abs(reading.lat) > 90 || Math.abs(reading.lng) > 180) {
        sensorError = 'unavailable'; showStatus(); return;
      }
      if (latest && reading.capturedAt <= latest.sensorAt) return;
      latest = {
        lat: reading.lat, lng: reading.lng, accuracy: reading.accuracy,
        at: Math.round(nowRef.current() - Math.max(0, age)), sensorAt: reading.capturedAt,
      };
      sensorError = null;
      pending = latest;
      setFix(latest);
      showStatus();
      void pump();
    };
    const onError = (reason: 'denied' | 'unavailable') => {
      if (!live()) return;
      sensorError = reason;
      if (reason === 'denied') {
        pending = null;
        setFix(null);
        setSharedAt(null);
        stopWatch();
        setStatus('denied');
        controller.abort();
        return;
      }
      showStatus();
    };
    try { stopWatch = provider.watch(onReading, onError); }
    catch { onError('unavailable'); }
    if (!live()) stopWatch();

    const timer = setInterval(() => {
      if (!live()) return;
      showStatus();
      void pump();
      // A stationary watch need not emit. Ask for a fresh sample without re-dating the old one.
      if ((!latest || Date.now() - latest.sensorAt >= FRESH_MS) &&
        !acquireInFlight && Date.now() - lastAcquisition >= FRESH_MS) {
        acquireInFlight = true;
        lastAcquisition = Date.now();
        try {
          provider.acquire(
            (reading) => { acquireInFlight = false; onReading(reading); },
            (reason) => { acquireInFlight = false; onError(reason); },
          );
        } catch { acquireInFlight = false; onError('unavailable'); }
      }
    }, 1_000);
    return () => {
      generation.current++;
      controller.abort();
      stopWatch();
      clearInterval(timer);
      pending = null;
    };
  }, [supported, enabled, sharing, visible, request, provider]);

  return { status, fix, sharedAt, enable, reset, enabled };
}
