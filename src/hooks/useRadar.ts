import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { RadarResponse } from '../types';

const WAITING_RETRY_MS = 3_000;
const ERROR_RETRY_MS = 10_000;

/**
 * Fetches the server's radar snapshot when it becomes eligible. The server caches each snapshot
 * for 60 s, so extra calls (refreshes, visibility changes) return the same frozen points.
 */
export function useRadar(active: boolean, visible: boolean, serverNow: () => number, hasFix: boolean) {
  const [radar, setRadar] = useState<RadarResponse | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverNowRef = useRef(serverNow);
  serverNowRef.current = serverNow;

  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    let delay = ERROR_RETRY_MS;
    try {
      const next = await api.getRadar();
      setRadar(next);
      delay = next.next_ping_at
        ? Math.max(500, next.next_ping_at - serverNowRef.current() + 250)
        : WAITING_RETRY_MS;
    } catch {
      // Keep the last snapshot and retry.
    }
    timer.current = setTimeout(() => void load(), delay);
  }, []);

  useEffect(() => {
    if (!active || !visible) return;
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, visible, load]);

  const waitingForOrigin = radar !== null && !radar.origin_available;
  useEffect(() => {
    if (!active || !visible || !hasFix || !waitingForOrigin) return;
    const soon = setTimeout(() => void load(), 1_000);
    return () => clearTimeout(soon);
  }, [active, visible, hasFix, waitingForOrigin, load]);

  useEffect(() => {
    if (!active) setRadar(null);
  }, [active]);

  return radar;
}
