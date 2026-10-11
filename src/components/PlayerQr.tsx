import QRCode from 'react-qr-code';
import { ModalDialog } from './ModalDialog';
import { PlayerAvatar } from './PlayerAvatar';
import { UiIcon } from './UiIcon';

interface PlayerQrProps {
  name: string;
  payload: string;
  tagCode: string;
  onClose: () => void;
}

export function PlayerQr({ name, payload, tagCode, onClose }: PlayerQrProps) {
  return (
    <ModalDialog label="My tag QR" onClose={onClose} variant="fullscreen">
      <div className="qr-shell">
        <header className="modal-topbar">
          <button className="icon-button" onClick={onClose} aria-label="Close QR code"><UiIcon name="close" /></button>
          <span className="modal-title">My runner code</span>
          <span className="topbar-spacer" />
        </header>
        <div className="qr-player">
          <PlayerAvatar name={name} role="runner" />
          <div><p className="eyebrow">Runner</p><h2>{name}</h2></div>
        </div>
        <div className="qr-presentation">
          <p>Let a Catcher scan this when they reach you.</p>
          <div className="qr-box">
            <QRCode value={payload} size={256} />
          </div>
          <div className="manual-tag-code">
            <span>Manual code</span>
            <strong aria-label="Manual tag code">{tagCode}</strong>
          </div>
        </div>
        <button className="btn runner-action" onClick={onClose}>Back to the game</button>
      </div>
    </ModalDialog>
  );
}
