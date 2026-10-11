import { useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';

interface ExitButtonProps {
  phase: 'lobby' | 'game';
  isHost: boolean;
  busy: boolean;
  onExit: () => Promise<string | null>;
}

export function ExitButton({ phase, isHost, busy, onExit }: ExitButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const label = phase === 'lobby' ? 'Exit room' : 'Exit game';
  const disabled = busy || pending;
  const close = () => {
    if (!submitting.current) { setOpen(false); setError(null); }
  };
  const confirm = async () => {
    if (submitting.current || busy) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const message = await onExit();
      if (message) setError(message);
      else setOpen(false);
    } catch {
      setError('Could not exit. Please try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <button className="btn secondary exit-button" disabled={busy} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <ModalDialog label={`${label}?`} onClose={close}>
          <div className="exit-confirmation">
            <h2>{label}?</h2>
            <p>You’ll return home and stop sharing your location.</p>
            {isHost ? (
              <p>{phase === 'lobby'
                ? 'You’re the host. This will close the room for everyone.'
                : 'You’re the host. This will end the game for everyone.'}</p>
            ) : phase === 'game' ? <p>You won’t be able to rejoin this game once you exit.</p> : null}
            {error && <p className="exit-error" role="alert">{error} You can try exiting again.</p>}
            <div className="exit-dialog-actions">
              <button className="btn secondary" disabled={disabled} onClick={close} autoFocus>Stay</button>
              <button className="btn danger" disabled={disabled} onClick={() => void confirm()}>{pending ? 'Exiting…' : 'Exit'}</button>
            </div>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
