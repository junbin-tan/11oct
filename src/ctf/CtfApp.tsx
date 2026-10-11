import { useEffect, useMemo, useRef, useState } from 'react';
import { ChaseScene } from '../components/ChaseScene';
import { GameCharacter } from '../components/GameCharacter';
import { ModalDialog } from '../components/ModalDialog';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerQr } from '../components/PlayerQr';
import { QrScanner } from '../components/QrScanner';
import { UiIcon } from '../components/UiIcon';
import { formatDuration } from '../hooks/useNow';
import type { CtfState, Landmark } from '../../server/ctf/types';
import { CTF, distance } from '../../server/ctf/rules';
import { ctfRequest, type SuggestionsResponse } from './api';
import { CtfMap } from './CtfMap';
import { useCtf } from './useCtf';
import './ctf.css';

function roleName(role: 'runner' | 'catcher') {
  return role === 'catcher' ? 'Catcher' : 'Runner';
}

function outcomeCopy(outcome: CtfState['game']['outcome']) {
  switch (outcome) {
    case 'flags_captured':
      return 'All three checkpoints were held for a full minute.';
    case 'all_caught':
      return 'Every remaining runner was caught.';
    case 'time_up':
      return 'Time ran out before all flags were captured.';
    default:
      return 'The host ended the round or departures prevented continued play. No winner was awarded.';
  }
}

function Crew({ state, players, showGps }: { state: CtfState; players: CtfState['players']; showGps: boolean }) {
  return (
    <ul className="roster player-roster">
      {players.map((p) => {
        const ready = p.gps_ready && (!state.game.start || p.eligible);
        const readyLabel = p.gps_ready
          ? state.game.start ? (p.eligible ? 'Inside area' : 'Outside area') : 'GPS ready'
          : 'Waiting for GPS';
        return (
          <li key={p.id} className={`player-row ${p.role}`}>
            <PlayerAvatar name={p.name} role={p.role} />
            <span className="player-copy">
              <strong>{p.name}{p.id === state.me.id ? ' (you)' : ''}</strong>
              <span>
                {roleName(p.role)}
                {p.left ? ' · left' : ''}
                {p.id === state.me.id && state.me.is_host && <span className="host-badge">Host</span>}
              </span>
            </span>
            {showGps && (
              <span className={`readiness${ready ? ' ready' : ''}`}>
                <span aria-hidden />{readyLabel}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FlagList({ flags }: { flags: CtfState['checkpoints'] }) {
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Checkpoints</p>
          <h2>The flags</h2>
        </div>
        <span className="count-pill">{flags.filter((flag) => flag.captured_at !== null).length} / {flags.length}</span>
      </div>
      <ol className="roster player-roster">
        {flags.map((flag, index) => (
          <li key={flag.id} className="player-row">
            <span className="rank-number" aria-hidden>{index + 1}</span>
            <span className="player-copy"><strong>{flag.name}</strong></span>
            <strong className={`ctf-flag-status${flag.captured_at !== null ? ' captured' : ''}`}>
              {flag.captured_at !== null ? 'Captured ✓' : 'Uncaptured'}
            </strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function CtfApp() {
  const { state, run, busy, error, setError, connected, now, gpsEnabled, gpsMessage, visible, enableGps } = useCtf();
  const [name, setName] = useState('');
  const [code, setCode] = useState(new URLSearchParams(window.location.search).get('room') ?? '');
  const [entry, setEntry] = useState<'create' | 'join'>(code ? 'join' : 'create');
  const [draft, setDraft] = useState<Landmark[]>([]);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'qr' | 'scan' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'leave' | 'end' | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const setupVersion = state?.game.setup_version;
  const roomCode = state?.game.code;

  useEffect(() => {
    const previous = document.title;
    document.title = 'Capture the Flag';
    return () => { document.title = previous; };
  }, []);
  useEffect(() => { setDraft([]); setEditing(false); setSelected(null); setNotice(''); }, [roomCode, setupVersion]);
  useEffect(() => { setNotice(''); }, [state?.game.status]);
  useEffect(() => { if (state?.game.status !== 'active' || state.me.role !== 'runner') setModal((current) => current === 'qr' ? null : current); }, [state?.game.status, state?.me.role]);
  useEffect(() => { if (state?.game.status !== 'active') setModal(null); }, [state?.game.status]);

  const staleIds = state?.players.filter((p) => p.location && now - p.location.captured_at > CTF.freshMs).map((p) => p.id).join(',') ?? '';
  // Repaint the map only on a server update or when a fix actually expires, not on every clock tick.
  const players = useMemo(() => {
    const expired = new Set(staleIds.split(','));
    return state?.players.map((p) => expired.has(p.id) ? { ...p, location: null, eligible: false, gps_ready: false } : p) ?? [];
  }, [state?.players, staleIds]);

  const self = players.find((p) => p.id === state?.me.id);
  const host = !!state?.me.is_host;
  const waiting = state?.game.status === 'waiting';
  const active = state?.game.status === 'active';
  const ended = state?.game.status === 'ended';
  const flags = editing ? draft : state?.checkpoints ?? [];

  const lookup = async () => {
    if (lookupBusy) return;
    setLookupBusy(true);
    setError('');
    const room = state?.game.code;
    const version = state?.game.setup_version;
    try {
      const result = await ctfRequest<SuggestionsResponse>('landmarks');
      if (!latest.current || latest.current.game.code !== room || latest.current.game.setup_version !== version || latest.current.game.status !== 'waiting') return;
      if (result.setup_version !== version) return;
      setDraft(result.suggestions);
      setEditing(true);
      setSelected(null);
      setNotice(result.unavailable
        ? 'Landmarks could not load. Tap the map to place three recognisable checkpoints.'
        : 'Review these places. Tap the map to add missing flags, or select a flag below to move it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not find landmarks.');
    } finally {
      setLookupBusy(false);
    }
  };

  const place = (point: { lat: number; lng: number }) => {
    if (!state?.game.start) return;
    if (distance(point, state.game.start) > 85) { setError('Place the flag within 85 m of the start.'); return; }
    const next = [...draft];
    if (selected !== null) next[selected] = { ...point, name: next[selected]!.name };
    else if (next.length < 3) next.push({ ...point, name: `Checkpoint ${next.length + 1}` });
    else { setNotice('Select Move beside a checkpoint, then tap its new position.'); return; }
    if (next.some((a, i) => next.slice(i + 1).some((b) => distance(a, b) <= 30))) { setError('Keep checkpoints more than 30 m apart.'); return; }
    setError('');
    setDraft(next);
    setSelected(null);
  };

  const remaining = state?.game.ends_at ? Math.max(0, Math.ceil((state.game.ends_at - now) / 1_000)) : 1800;
  const attempt = state?.attempt;
  const progressValid = attempt && connected && visible && self?.eligible && now - attempt.last_received_at <= 10_000 && now - attempt.last_captured_at <= 10_000;
  const progress = progressValid ? Math.min(60, Math.floor(attempt.elapsed_ms / 1000)) : 0;
  const currentFlag = state?.checkpoints.find((flag) => flag.id === attempt?.checkpoint_id);
  const captured = state?.checkpoints.filter((flag) => flag.captured_at !== null).length ?? 0;
  const runnerCount = players.filter((p) => p.role === 'runner' && !p.left).length;
  const catcherCount = players.filter((p) => p.role === 'catcher' && !p.left).length;
  const gpsControl = gpsEnabled ? (
    <p className="gps gps-chip" role="status"><UiIcon name="location" size={17} />{gpsMessage}</p>
  ) : (
    <button className="btn location-action" onClick={enableGps}><UiIcon name="location" size={18} />Enable GPS</button>
  );
  const gpsNeedsAttention = !gpsEnabled || (active && !self?.eligible);

  const copyInvite = async () => {
    if (!state) return;
    const url = `${window.location.origin}/capture-the-flag?room=${state.game.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Invite link copied.');
    } catch {
      setNotice(`Share this room code: ${state.game.code}`);
    }
  };

  return (
    <div className={`app ctf-app${active && state ? ` role-${state.me.role}` : ''}`}>
      <div className="status-stack" aria-live="polite">
        {!connected && <div className="banner">Connection interrupted. Reconnecting… Captures require fresh GPS uploads.</div>}
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner">{notice}</div>}
      </div>

      {state === undefined && (
        <main className="screen loading-screen">
          <div className="loading-orbit" aria-hidden><span /></div>
          <p>Connecting to Capture the Flag…</p>
        </main>
      )}

      {state === null && (
        <main className="screen home">
          <header className="home-hero">
            <p className="eyebrow home-kicker"><span aria-hidden="true">⚑</span> A separate way to play</p>
            <h1 className="arcade-wordmark ctf-wordmark" aria-label="Capture the Flag"><span aria-hidden="true">CAPTURE</span><span aria-hidden="true">FLAG</span></h1>
            <p className="lede">Hold your ground. Keep the chase alive.</p>
            <ChaseScene />
            <ol className="how-to-play" aria-label="How to play">
              <li><span className="rule-number">1</span><span className="rule-copy"><strong>3 flags</strong><span>Inside 100 m</span></span></li>
              <li><span className="rule-number">2</span><span className="rule-copy"><strong>60 s hold</strong><span>Capture each</span></span></li>
              <li><span className="rule-number">3</span><span className="rule-copy"><strong>30 min</strong><span>Beat the clock</span></span></li>
            </ol>
          </header>

          <form className="join-card stack" onSubmit={(event) => { event.preventDefault(); void run(entry, { name, code }); }}>
            <div className="segmented" role="tablist" aria-label="Create or join">
              <button type="button" role="tab" aria-selected={entry === 'create'} className={entry === 'create' ? 'active' : ''} onClick={() => setEntry('create')}>Create</button>
              <button type="button" role="tab" aria-selected={entry === 'join'} className={entry === 'join' ? 'active' : ''} onClick={() => setEntry('join')}>Join</button>
            </div>
            <div className="form-intro">
              <h2>{entry === 'create' ? 'Start some chaos.' : 'Your crew is waiting.'}</h2>
              <p>{entry === 'create' ? 'You’ll begin as the first Catcher.' : 'Enter the code your host shared.'}</p>
            </div>
            <label>
              Your name
              <input value={name} maxLength={24} required autoComplete="nickname" placeholder="e.g. Alex" onChange={(e) => setName(e.target.value)} />
            </label>
            {entry === 'join' && (
              <label>
                Room code
                <input value={code} maxLength={6} minLength={6} required autoCapitalize="characters" autoComplete="off" placeholder="ABC123" className="code-input" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              </label>
            )}
            <button className="btn primary" disabled={busy || !name.trim() || (entry === 'join' && code.length !== 6)}>
              {busy ? 'Connecting…' : entry === 'create' ? 'Create Capture the Flag' : 'Join Capture the Flag'}
              {!busy && <span aria-hidden="true">↗</span>}
            </button>
          </form>
          <p className="privacy-note">
            This mode has its own rooms and settings. Your original game is kept separate.{' '}
            <a className="ctf-home-link" href="/">Original game ↗</a>
          </p>
        </main>
      )}

      {state && waiting && (
        <main className="screen lobby has-action-dock">
          <header className="screen-bar">
            <div>
              <p className="eyebrow">Capture the Flag</p>
              <h1>Round up the crew.</h1>
            </div>
            <div className="screen-bar-actions">
              <span className="stage-pill">Lobby</span>
              <button className="btn secondary exit-button" onClick={() => setConfirmAction('leave')}>Leave</button>
            </div>
          </header>

          <section className="invite-card invite-ticket" aria-labelledby="room-code-label">
            <GameCharacter role="runner" className="ticket-character" />
            <div className="invite-card-copy">
              <p className="eyebrow" id="room-code-label">Room code</p>
              <p className="room-code">{state.game.code}</p>
              <p className="ticket-caption">Share this room code. Bring your fastest friends.</p>
            </div>
            <div className="ticket-stub">
              <div className="avatar-stack" aria-hidden="true">
                {players.slice(0, 4).map((player) => <PlayerAvatar key={player.id} name={player.name} role={player.role} small />)}
                {players.length > 4 && <span className="avatar-more">+{players.length - 4}</span>}
              </div>
              <div className="ticket-invite">
                <span className="share-feedback" role="status">{notice === 'Invite link copied.' ? 'Invite ready!' : 'Invite crew'}</span>
                <button className="icon-button share-button" onClick={() => void copyInvite()} aria-label="Share invite link"><UiIcon name="share" size={20} /></button>
              </div>
            </div>
          </section>

          {gpsControl}

          <section className="round-settings">
            <div>
              <p className="eyebrow">Setup</p>
              <h2>{host ? 'Set your starting area' : 'Waiting for the host'}</h2>
            </div>
            <p className="duration-hint">Everyone needs GPS accurate to 15 m and must gather inside the 100 m circle. The host stays within 15 m of the start.</p>
            {host && (
              <div className="ctf-actions">
                <button className="btn" disabled={busy || !self?.gps_ready || lookupBusy} onClick={() => void run('setup/start')}>{state.game.start ? 'Reset start to my location' : 'Use my location as start'}</button>
                {state.game.start && (
                  <>
                    <button className="btn" disabled={busy || lookupBusy} onClick={() => void lookup()}>{lookupBusy ? 'Finding landmarks…' : 'Suggest landmarks'}</button>
                    <button className="btn" disabled={busy || lookupBusy} onClick={() => { setDraft(state.checkpoints.map(({ name: flagName, lat, lng }) => ({ name: flagName, lat, lng }))); setEditing(true); setNotice('Tap the map to place flags. Select Move to reposition a flag.'); }}>Place / edit flags</button>
                  </>
                )}
              </div>
            )}
            <p className="duration-hint">{state.game.confirmed ? 'Three checkpoints confirmed.' : 'The host confirms three recognisable places before starting.'} Round duration: 30 minutes.</p>
          </section>

          <CtfMap start={state.game.start} flags={flags} players={players} selfId={state.me.id} onPlace={host && editing && !busy && !lookupBusy ? place : undefined} />

          {host && editing && (
            <section className="round-settings">
              <div>
                <p className="eyebrow">Host review</p>
                <h2>Review checkpoints · {draft.length}/3</h2>
              </div>
              <p className="duration-hint">Choose recognisable, accessible spots. Each flag must be within 85 m of the start and more than 30 m from another flag.</p>
              {draft.map((flag, i) => (
                <div className="ctf-edit-flag" key={i}>
                  <label>Flag {i + 1}<input value={flag.name} maxLength={80} onChange={(e) => setDraft((old) => old.map((item, n) => n === i ? { ...item, name: e.target.value } : item))} /></label>
                  <button className="btn" aria-pressed={selected === i} onClick={() => { setSelected(i); setNotice(`Tap the new position for ${flag.name}.`); }}>Move</button>
                  <button className="btn" onClick={() => { setDraft((old) => old.filter((_, n) => n !== i)); setSelected(null); }}>Remove</button>
                </div>
              ))}
              {draft.length < 3 && <p className="notice">Tap the map to add {3 - draft.length} more {draft.length === 2 ? 'flag' : 'flags'}.</p>}
              <button className="btn primary" disabled={busy || lookupBusy || draft.length !== 3 || draft.some((flag) => !flag.name.trim())} onClick={async () => {
                const result = await run('setup/checkpoints', { setup_version: state.game.setup_version, checkpoints: draft }, 'PUT');
                if (result) { setEditing(false); setNotice('Checkpoints confirmed. Gather everyone inside the boundary.'); }
              }}>Confirm checkpoints</button>
            </section>
          )}

          {!!state.checkpoints.length && !editing && <FlagList flags={state.checkpoints} />}

          <div className="section-heading">
            <div>
              <p className="eyebrow">The starting lineup</p>
              <h2>Your crew</h2>
            </div>
            <span className="count-pill"><UiIcon name="users" size={15} />{players.length}</span>
          </div>
          <Crew state={state} players={players} showGps />

          <div className="action-dock">
            {host ? (
              <button className="btn primary dock-action" disabled={busy || editing || lookupBusy || !state.game.confirmed || players.length < 2 || players.some((p) => !p.eligible)} onClick={() => void run('start')}>
                <UiIcon name="play" />Start Capture the Flag
              </button>
            ) : (
              <p className="waiting-dock"><span className="status-pulse" aria-hidden />Keep this page open. The host will start when everyone is ready.</p>
            )}
          </div>
        </main>
      )}

      {state && active && (
        <main className="screen game has-action-dock">
          <div className="screen-bar game-exit-bar">
            <p className="eyebrow">Room {state.game.code}</p>
            <button className="btn secondary exit-button" onClick={() => setConfirmAction('leave')}>Leave</button>
          </div>

          <section className="game-hud" aria-label="Your role and game status">
            <header className={`role-hero ${state.me.role}`}>
              <GameCharacter role={state.me.role} className="role-character" />
              <div className="role-copy">
                <p className="eyebrow">You are a</p>
                <h1 className="role-label">{roleName(state.me.role)}</h1>
                <p className="role-hint">{state.me.role === 'catcher' ? 'Scan a runner. Grow your team.' : 'Hold a flag for a full minute.'}</p>
              </div>
            </header>
            <div className="metric-strip" aria-label="Game status">
              <span><strong>{captured} / 3</strong><small>Flags</small></span>
              <span><strong>{runnerCount}/{catcherCount}</strong><small>Runners / Catchers</small></span>
              <span className={`time-left${remaining <= 60 ? ' running-low' : ''}`} role="timer" aria-label="Time left"><strong>{formatDuration(remaining * 1000)}</strong><small>Time left</small></span>
            </div>
            <div className="team-balance" aria-hidden="true">
              <span className="runner-segment" style={{ width: `${players.length ? (runnerCount / Math.max(1, runnerCount + catcherCount)) * 100 : 0}%` }} />
              <span className="catcher-segment" style={{ width: `${players.length ? (catcherCount / Math.max(1, runnerCount + catcherCount)) * 100 : 0}%` }} />
            </div>
          </section>

          {gpsNeedsAttention && gpsControl}
          {active && !self?.eligible && (
            <p className="notice" role="status">
              {self?.gps_ready ? 'Outside the 100 m boundary. Return inside to capture or tag.' : 'Fresh GPS accurate to 15 m is required to capture or tag.'} Your capture attempt resets.
            </p>
          )}

          <CtfMap start={state.game.start} flags={flags} players={players} selfId={state.me.id} />

          {!gpsNeedsAttention && gpsControl}

          {state.me.role === 'runner' && (
            <section className="round-settings ctf-capture">
              <h2>{progressValid ? `Capturing ${currentFlag?.name ?? 'flag'}` : 'Find an uncaptured flag'}</h2>
              <p className="duration-hint">Stay within 15 m for one uninterrupted minute. Leaving or getting caught resets your attempt.</p>
              <progress aria-label="Capture progress" max={60} value={progress} />
              <strong>{progress} / 60 seconds verified</strong>
            </section>
          )}
          {state.me.role === 'catcher' && (
            <section className="round-settings">
              <h2>Stop the captures.</h2>
              <p className="duration-hint">Catch runners and scan their QR code or enter their tag code to turn them into catchers.</p>
            </section>
          )}

          {!!state.checkpoints.length && <FlagList flags={state.checkpoints} />}

          <details className="room-panel">
            <summary>Your crew · {state.game.code}</summary>
            <Crew state={state} players={players} showGps />
            {host && <button className="btn danger" onClick={() => setConfirmAction('end')}>End this round</button>}
          </details>

          <div className={`action-dock role-dock ctf-dock ${state.me.role}`}>
            <button className="btn role-primary dock-action" disabled={state.me.role === 'catcher' && (!self?.eligible || !connected)} onClick={() => setModal(state.me.role === 'catcher' ? 'scan' : 'qr')}>
              <UiIcon name={state.me.role === 'catcher' ? 'scan' : 'qr'} />
              {state.me.role === 'catcher' ? 'Scan / enter runner code' : 'Show my tag QR'}
            </button>
          </div>
        </main>
      )}

      {state && ended && (
        <main className="screen results has-action-dock">
          <header className={`results-hero ${state.game.winner === 'catchers' ? 'catchers-win' : state.game.winner === 'runners' ? 'runners-survive' : 'departure-ending'}`}>
            {state.game.winner && <div className="confetti" aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>}
            <p className="eyebrow round-complete">{state.game.winner ? 'Round complete' : 'Round interrupted'}</p>
            <GameCharacter role={state.game.winner === 'catchers' ? 'catcher' : 'runner'} className="results-character" celebratory={!!state.game.winner} />
            <h1>{state.game.winner === 'runners' ? 'Runners captured every flag!' : state.game.winner === 'catchers' ? 'Catchers win!' : 'Round interrupted'}</h1>
            <p>{outcomeCopy(state.game.outcome)}</p>
          </header>
          <div className="result-metrics">
            <span><strong>{captured} / 3</strong><small>Flags captured</small></span>
            <span><strong>{runnerCount}</strong><small>{runnerCount === 1 ? 'Runner' : 'Runners'}</small></span>
            <span><strong>{catcherCount}</strong><small>{catcherCount === 1 ? 'Catcher' : 'Catchers'}</small></span>
          </div>
          {!!state.checkpoints.length && <FlagList flags={state.checkpoints} />}
          <div className="section-heading">
            <div>
              <p className="eyebrow">Final standings</p>
              <h2>Your crew</h2>
            </div>
            <span className="count-pill"><UiIcon name="users" size={15} />{players.length}</span>
          </div>
          <Crew state={state} players={players} showGps={false} />
          <div className="action-dock">
            <button className="btn primary dock-action" disabled={busy} onClick={() => void run('leave')}><UiIcon name="play" />{busy ? 'Leaving…' : 'New game'}</button>
          </div>
        </main>
      )}

      {confirmAction && (
        <ModalDialog label={confirmAction === 'end' ? 'End round' : 'Leave room'} onClose={() => setConfirmAction(null)}>
          <div className="exit-confirmation">
            <h2>{confirmAction === 'end' ? 'End this round?' : 'Leave this room?'}</h2>
            <p>{host ? 'Leaving or ending as host interrupts the round for everyone.' : 'You cannot rejoin after the round starts.'}</p>
            <div className="exit-dialog-actions">
              <button className="btn secondary" onClick={() => setConfirmAction(null)} autoFocus>Stay</button>
              <button className="btn danger" disabled={busy} onClick={async () => { const result = await run(confirmAction); if (result) setConfirmAction(null); }}>{confirmAction === 'end' ? 'End round' : 'Leave room'}</button>
            </div>
          </div>
        </ModalDialog>
      )}
      {state && modal === 'qr' && <PlayerQr name={state.me.name} payload={state.me.qr_payload} tagCode={state.me.tag_code} onClose={() => setModal(null)} />}
      {state && modal === 'scan' && (
        <QrScanner onClose={() => setModal(null)} onSubmit={async (input) => {
          const result = await run('tag', input);
          if (!result) return 'Could not tag. Check your GPS, boundary, and runner code.';
          setModal(null);
          setNotice('Tag recorded. The runner is now a catcher.');
          return null;
        }} />
      )}
    </div>
  );
}
