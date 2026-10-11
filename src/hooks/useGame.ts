import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import type { GameState } from '../types';

export const POLL_INTERVAL_MS = 3_000;

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

export function useGame() {
  const [state, setState] = useState<GameState | null | undefined>(undefined);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const visible = usePageVisible();

  const nextSeq = useRef(0);
  const appliedSeq = useRef(0);
  const polling = useRef(false);

  const apply = useCallback((seq: number, next: GameState | null) => {
    if (seq < appliedSeq.current) return;
    appliedSeq.current = seq;
    setState(next);
    if (next) setClockOffset(next.server_now - Date.now());
  }, []);

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const seq = ++nextSeq.current;
    try {
      const { state: next } = await api.getState();
      apply(seq, next);
      setReconnecting(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK') setReconnecting(true);
      else setState((prev) => (prev === undefined ? null : prev));
    } finally {
      polling.current = false;
    }
  }, [apply]);

  const run = useCallback(
    async <T extends { state: GameState }>(
      action: () => Promise<T>,
      { quiet = false }: { quiet?: boolean } = {},
    ): Promise<{ data: T | null; error: string | null }> => {
      const seq = ++nextSeq.current;
      setBusy(true);
      setError(null);
      try {
        const response = await action();
        apply(seq, response.state);
        setReconnecting(false);
        return { data: response, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong.';
        if (!quiet) setError(message);
        return { data: null, error: message };
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const leave = useCallback(() => {
    appliedSeq.current = ++nextSeq.current;
    setState(null);
    setError(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = state?.game.status;
  useEffect(() => {
    if (!visible || !status || status === 'ended') return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, status, refresh]);

  const serverNow = useCallback(() => Date.now() + clockOffset, [clockOffset]);

  return { state, reconnecting, error, setError, busy, run, leave, serverNow, visible };
}
