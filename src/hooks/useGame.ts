import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
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
  const actionPending = useRef(false);

  const apply = useCallback((seq: number, next: GameState | null, sentAt: number) => {
    if (seq < appliedSeq.current) return;
    appliedSeq.current = seq;
    setState(next);
    // Approximate the server clock at the request midpoint, not at response receipt.
    if (next) setClockOffset(next.server_now - (sentAt + Date.now()) / 2);
  }, []);

  const refresh = useCallback(async () => {
    if (polling.current || actionPending.current) return;
    polling.current = true;
    const seq = ++nextSeq.current;
    const sentAt = Date.now();
    try {
      const { state: next } = await api.getState();
      apply(seq, next, sentAt);
      if (seq >= appliedSeq.current) setReconnecting(false);
    } catch {
      if (seq >= appliedSeq.current) setReconnecting(true);
    } finally {
      polling.current = false;
    }
  }, [apply]);

  const run = useCallback(
    async <T extends { state: GameState | null }>(
      action: () => Promise<T>,
      { quiet = false }: { quiet?: boolean } = {},
    ): Promise<{ data: T | null; error: string | null }> => {
      if (actionPending.current) return { data: null, error: 'Please wait for the current action to finish.' };
      actionPending.current = true;
      // Invalidate older polls before the mutation; none may start while it is pending.
      const seq = ++nextSeq.current;
      appliedSeq.current = seq;
      const sentAt = Date.now();
      setBusy(true);
      setError(null);
      try {
        const response = await action();
        apply(seq, response.state, sentAt);
        setReconnecting(false);
        return { data: response, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong.';
        if (!quiet) setError(message);
        return { data: null, error: message };
      } finally {
        actionPending.current = false;
        setBusy(false);
      }
    },
    [apply],
  );

  const leave = useCallback(async () => {
    const result = await run(() => api.leaveGame());
    return result.error;
  }, [run]);

  const phase = state === undefined ? 'loading' : state === null ? 'home' : state.game.status;
  useEffect(() => {
    if (busy || !visible || phase === 'home' || phase === 'ended') return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, phase, busy, refresh]);

  const serverNow = useCallback(() => Date.now() + clockOffset, [clockOffset]);

  return { state, reconnecting, error, setError, busy, run, leave, refresh, serverNow, visible };
}
