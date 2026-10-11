import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

export const GPS_INTERVAL_MS = 10_000;

export type GpsStatus = 'off' | 'requesting' | 'active' | 'denied' | 'unavailable' | 'unsupported';

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: number;
}

const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 15_000,
};

/**
 * Acquires a fresh fix every 10 s and uploads it while `sharing` is true and the page is visible.
 * Tracking stops entirely when `sharing` turns false; callbacks that arrive afterwards are ignored.
 */
export function useGeolocation(sharing: boolean, visible: boolean) {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<GpsStatus>(supported ? 'off' : 'unsupported');
  const [fix, setFix] = useState<Fix | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const enable = useCallback(() => {
    if (!supported) return;
    setEnabled(true);
    setStatus('requesting');
    setAttempt((n) => n + 1);
  }, [supported]);

  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((permission) => {
        if (!cancelled && permission.state === 'granted') enable();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [supported, enable]);

  useEffect(() => {
    if (!supported || !enabled || !sharing || !visible) return;
    const gen = ++generation.current;
    inFlight.current = false;

    const tick = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (gen !== generation.current) return;
          inFlight.current = false;
          const next: Fix = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
            at: Date.now(),
          };
          setFix(next);
          setStatus('active');
          api.updateLocation(next.lat, next.lng, next.accuracy).catch(() => {});
        },
        (error) => {
          if (gen !== generation.current) return;
          inFlight.current = false;
          setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
        },
        POSITION_OPTIONS,
      );
    };

    tick();
    const timer = setInterval(tick, GPS_INTERVAL_MS);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [supported, enabled, sharing, visible, attempt]);

  useEffect(() => {
    if (!sharing) setFix(null);
  }, [sharing]);

  return { status, fix, enable, enabled };
}
