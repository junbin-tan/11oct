import { useState, type FormEvent } from 'react';
import { ChaseScene } from '../components/ChaseScene';

const NAME_KEY = 'gps-tag:name';

interface HomeProps {
  initialCode: string;
  busy: boolean;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}

export function Home({ initialCode, busy, onCreate, onJoin }: HomeProps) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [mode, setMode] = useState<'create' | 'join'>(initialCode ? 'join' : 'create');
  const [code, setCode] = useState(initialCode);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && (mode === 'create' || code.trim().length === 6) && !busy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    localStorage.setItem(NAME_KEY, trimmed);
    if (mode === 'create') onCreate(trimmed);
    else onJoin(code.trim(), trimmed);
  };

  return (
    <main className="screen home">
      <header className="home-hero">
        <p className="eyebrow home-kicker"><span aria-hidden="true">✳</span> Your playground. Your people.</p>
        <h1 className="arcade-wordmark"><span>GPS</span> <span>TAG</span></h1>
        <p className="lede">Big chase energy. In real life.</p>
        <ChaseScene />
        <ol className="how-to-play" aria-label="How to play">
          <li><span className="rule-number">1</span><span className="rule-copy"><strong>Team up</strong><span>Invite friends</span></span></li>
          <li><span className="rule-number">2</span><span className="rule-copy"><strong>Chase</strong><span>Scan a Runner</span></span></li>
          <li><span className="rule-number">3</span><span className="rule-copy"><strong>Recruit</strong><span>Grow your team</span></span></li>
        </ol>
      </header>

      <form onSubmit={submit} className="join-card stack">
        <div className="segmented" role="tablist" aria-label="Game action">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'active' : ''}
            onClick={() => setMode('create')}
          >
            Create
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={mode === 'join' ? 'active' : ''}
            onClick={() => setMode('join')}
          >
            Join
          </button>
        </div>

        <div className="form-intro">
          <h2>{mode === 'create' ? 'Start some chaos.' : 'Your crew is waiting.'}</h2>
          <p>{mode === 'create' ? 'You’ll begin as the first Catcher.' : 'Enter the code your host shared.'}</p>
        </div>

        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            placeholder="e.g. Alex"
            required
          />
        </label>

        {mode === 'join' && (
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABC123"
              className="code-input"
            />
          </label>
        )}

        <button className="btn primary home-submit" disabled={!canSubmit}>
          {busy ? 'Please wait…' : mode === 'create' ? 'Create game' : 'Join game'}
          {!busy && <span aria-hidden="true">↗</span>}
        </button>
      </form>

      <p className="privacy-note">
        GPS works only while the game is open. We keep your latest position, never your route.
      </p>
    </main>
  );
}
