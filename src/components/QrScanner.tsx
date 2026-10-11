import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { useEffect, useRef, useState, type FormEvent } from 'react';

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

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Scan to tag">
      <div className="modal-card">
        <h2>Scan to tag</h2>
        {cameraError ? (
          <p className="notice">{cameraError}</p>
        ) : (
          <video ref={videoRef} className="scanner-video" muted playsInline autoPlay />
        )}
        <form onSubmit={onManual} className="row">
          <input
            aria-label="Tag code"
            placeholder="Tag code"
            value={code}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn" disabled={submitting || code.trim().length !== 6}>
            Tag
          </button>
        </form>
        {submitting && <p>Tagging…</p>}
        {message && <p className="error">{message}</p>}
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
