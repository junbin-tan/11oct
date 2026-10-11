import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useGame } from './hooks/useGame';
import { useGeolocation } from './hooks/useGeolocation';
import { useNow } from './hooks/useNow';
import { useRadar } from './hooks/useRadar';
import type { GameState } from './types';
import { Game } from './views/Game';
import { Home } from './views/Home';
import { Lobby } from './views/Lobby';
import { Results } from './views/Results';

export type View = 'loading' | 'home' | 'lobby' | 'game' | 'results';

export function viewFor(state: GameState | null | undefined): View {
  if (state === undefined) return 'loading';
  if (state === null) return 'home';
  switch (state.game.status) {
    case 'waiting':
      return 'lobby';
    case 'active':
      return 'game';
    case 'ended':
      return 'results';
  }
}

function initialRoomCode(): string {
  const code = new URLSearchParams(window.location.search).get('room') ?? '';
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function App() {
  const { state, reconnecting, error, busy, run, leave, serverNow, visible } = useGame();
  const view = viewFor(state);
  const [toast, setToast] = useState<string | null>(null);
  const [inviteCode] = useState(initialRoomCode);
  const [blockedInvite, setBlockedInvite] = useState<string | null>(null);
  const inviteHandled = useRef(false);

  const sharing = view === 'lobby' || view === 'game';
  const gps = useGeolocation(sharing, visible, serverNow);
  const { radar, reconnecting: radarReconnecting } = useRadar(view === 'game', visible, serverNow, gps.sharedAt !== null);
  const nowMs = useNow(serverNow);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const previousRole = useRef(state?.me.role);
  useEffect(() => {
    const role = state?.me.role;
    if (view === 'game' && previousRole.current === 'runner' && role === 'catcher') {
      showToast('You were caught! You are now a catcher.');
      navigator.vibrate?.(300);
    }
    previousRole.current = role;
  }, [state?.me.role, view, showToast]);

  useEffect(() => {
    if (state === undefined || inviteHandled.current) return;
    inviteHandled.current = true;
    if (window.location.search) window.history.replaceState(null, '', '/');
    if (!state || !inviteCode || state.game.code === inviteCode) return;
    if (state.game.status === 'ended') void leave();
    else setBlockedInvite(inviteCode);
  }, [state, inviteCode, leave]);

  useEffect(() => {
    if (state === null) setBlockedInvite(null);
  }, [state]);

  const onTag = async (input: { payload: string } | { code: string }) => {
    const { data, error: tagError } = await run(() => api.tag(input), { quiet: true });
    if (data) {
      showToast(
        data.result.outcome === 'tagged'
          ? `You caught ${data.result.target_name}!`
          : `${data.result.target_name} is already a catcher.`,
      );
    }
    return tagError;
  };

  const role = view === 'game' ? state?.me.role : undefined;

  return (
    <div className={`app ${role ? `role-${role}` : ''}`}>
      <div className="status-stack" aria-live="polite">
        {reconnecting && <div className="banner"><span className="status-pulse" aria-hidden />Reconnecting…</div>}
        {blockedInvite && view !== 'home' && view !== 'loading' && (
          <div className="banner">Exit this room or finish the game before joining {blockedInvite}.</div>
        )}
        {error && <div className="banner error">{error}</div>}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}

      {view === 'loading' && (
        <main className="screen loading-screen">
          <div className="loading-orbit" aria-hidden><span /></div>
          <p>Finding your game…</p>
        </main>
      )}
      {view === 'home' && (
        <Home
          initialCode={inviteCode}
          busy={busy}
          onCreate={(name) => void run(() => api.createGame(name))}
          onJoin={(code, name) => void run(() => api.joinGame(code, name))}
        />
      )}
      {view === 'lobby' && state && (
        <Lobby
          state={state}
          gpsStatus={gps.status}
          busy={busy}
          onEnableGps={gps.enable}
          onResetGps={gps.reset}
          onStart={() => void run(() => api.startGame())}
          onExit={leave}
        />
      )}
      {view === 'game' && state && (
        <Game
          state={state}
          radar={radar}
          radarReconnecting={radarReconnecting}
          visible={visible}
          nowMs={nowMs}
          gpsStatus={gps.status}
          busy={busy}
          onEnableGps={gps.enable}
          onResetGps={gps.reset}
          onTag={onTag}
          onEnd={() => void run(() => api.endGame())}
          onExit={leave}
        />
      )}
      {view === 'results' && state && <Results state={state} busy={busy} onNewGame={() => void leave()} />}
    </div>
  );
}
