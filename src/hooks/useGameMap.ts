import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MapResponse } from '../types';

/** Mounted only by the map dialog; visibility and unmount cancel pending work. */
export function useGameMap(visible: boolean) {
  const [snapshot, setSnapshot] = useState<MapResponse | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      let delay = 5_000;
      try {
        const next = await api.getMap(controller.signal);
        if (cancelled) return;
        setSnapshot(next);
        setReconnecting(false);
      } catch {
        if (cancelled) return;
        setReconnecting(true);
        delay = 10_000;
      }
      if (!cancelled) timer = setTimeout(() => void load(), delay);
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [visible]);
  return { snapshot, reconnecting };
}
