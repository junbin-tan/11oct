import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ModalDialog } from './ModalDialog';
import { UiIcon } from './UiIcon';

const REPEAT_SUPPRESS_MS = 3_000;
const SCAN_DELAY_MS = 150;

interface QrScannerProps {
  /** Resolves to an error message, or null when the tag succeeded. */
  onSubmit: (input: { payload: string } | { code: string }) => Promise<string | null>;
  onClose: () => void;
}

function stopVideo(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;
  if (stream && typeof (stream as MediaStream).getTracks === 'function') {
    (stream as MediaStream).getTracks().forEach((track) => track.stop());
  }
  if (video) video.srcObject = null;
}

export function QrScanner({ onSubmit, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const lastRead = useRef<{ text: string; at: number } | null>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const submit = async (input: { payload: string } | { code: string }) => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const error = await onSubmitRef.current(input);
      if (error) setMessage(error);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    let cancelled = false;
    let controls: IScannerControls | null = null;
    const video = videoRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not available in this browser. Enter the tag code instead.');
      return;
    }

    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: SCAN_DELAY_MS });
    reader
      .decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' } } }, video!, (result) => {
        if (!result || cancelled || busy.current) return;
        const text = result.getText();
        const now = Date.now();
        if (lastRead.current && lastRead.current.text === text && now - lastRead.current.at < REPEAT_SUPPRESS_MS) {
          return;
        }
        lastRead.current = { text, at: now };
        void submitRef.current({ payload: text });
      })
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const name = error instanceof Error ? error.name : '';
        setCameraError(
          name === 'NotAllowedError'
            ? 'Camera permission denied. Enter the tag code instead.'
            : 'Could not start the camera. Enter the tag code instead.',
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
      stopVideo(video);
    };
  }, []);

  const onManual = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) void submit({ code: code.trim() });
  };

  const showManual = manualOpen || cameraError !== null;

  return (
    <ModalDialog label="Scan to tag" onClose={onClose} variant="fullscreen">
      <div className="scanner-shell">
        <header className="modal-topbar">
          <button className="icon-button" onClick={onClose} aria-label="Close scanner"><UiIcon name="close" /></button>
          <span className="modal-title">Scan a Runner</span>
          <span className="catcher-mini-mark" aria-hidden />
        </header>

        <div className={`scanner-stage ${cameraError ? 'has-error' : ''}`}>
          {!cameraError && <video ref={videoRef} className="scanner-video" muted playsInline autoPlay />}
          <span className="scan-corner top-left" aria-hidden />
          <span className="scan-corner top-right" aria-hidden />
          <span className="scan-corner bottom-left" aria-hidden />
          <span className="scan-corner bottom-right" aria-hidden />
          {cameraError && <p className="scanner-error"><UiIcon name="scan" size={28} />{cameraError}</p>}
        </div>

        <div className="scanner-copy">
          <h2>{cameraError ? 'Their code. Your next catch.' : 'Line up their QR code'}</h2>
          <p>{cameraError ? 'Ask the Runner for their six-character tag code.' : 'Hold steady—the tag happens automatically.'}</p>
        </div>

        {!showManual && (
          <button className="btn scanner-manual-toggle" type="button" onClick={() => setManualOpen(true)}>
            Enter code instead
          </button>
        )}

        {showManual && (
          <form onSubmit={onManual} className="manual-code-panel">
            <label>
              Runner’s tag code
              <input
                aria-label="Tag code"
                placeholder="ABC123"
                value={code}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                className="code-input"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
            <button className="btn catcher-action" aria-label="Tag" disabled={submitting || code.trim().length !== 6}>
              <UiIcon name="scan" />{submitting ? 'Tagging…' : 'Tag Runner'}
            </button>
          </form>
        )}
        {message && <p className="error scanner-message" role="alert">{message}</p>}
      </div>
    </ModalDialog>
  );
}
