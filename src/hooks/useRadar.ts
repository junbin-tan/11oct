import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { RadarResponse } from '../types';

const WAITING_RETRY_MS = 3_000;
const ERROR_RETRY_MS = 10_000;

/**
 * Fetches the server's radar snapshot when it becomes eligible. The server caches each snapshot
 * for 60 s, so extra calls (refreshes, visibility changes) return the same frozen points.
 * An in-flight response cannot schedule another fetch after this effect stops.
 */
export function useRadar(active: boolean, visible: boolean, serverNow: () => number, hasFix: boolean) {
  const [radar, setRadar] = useState<RadarResponse | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const serverNowRef = useRef(serverNow);
  serverNowRef.current = serverNow;
  const waitingForOrigin = radar === null || !radar.origin_available;

  useEffect(() => {
    if (!active) setRadar(null);
  }, [active]);

  useEffect(() => {
    if (!active || !visible || !hasFix || !waitingForOrigin) return;
    const soon = setTimeout(() => setRefreshToken((n) => n + 1), 1_000);
    return () => clearTimeout(soon);
  }, [active, visible, hasFix, waitingForOrigin]);

  useEffect(() => {
    if (!active || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      let delay = ERROR_RETRY_MS;
      try {
        const next = await api.getRadar();
        if (cancelled) return;
        setRadar(next);
        delay = next.next_ping_at
          ? Math.max(500, next.next_ping_at - serverNowRef.current() + 250)
          : WAITING_RETRY_MS;
      } catch {
        if (cancelled) return;
      }
      if (!cancelled) timer = setTimeout(() => void load(), delay);
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, visible, refreshToken]);

  return radar;
}
