import { useState, type FormEvent } from 'react';

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
      <h1>GPS Tag</h1>
      <p className="lede">Infection tag for your phone. Catchers scan runners’ QR codes; every catch joins the hunt.</p>
      <p className="fine-print">
        GPS is foreground-only. The game stores your latest fix, not your route, and clears it when the round ends.
      </p>

      <form onSubmit={submit} className="stack">
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

        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'active' : ''}
            onClick={() => setMode('create')}
          >
            Create game
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={mode === 'join' ? 'active' : ''}
            onClick={() => setMode('join')}
          >
            Join game
          </button>
        </div>

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

        <button className="btn" disabled={!canSubmit}>
          {busy ? 'Please wait…' : mode === 'create' ? 'Create game' : 'Join game'}
        </button>
      </form>
    </main>
  );
}
