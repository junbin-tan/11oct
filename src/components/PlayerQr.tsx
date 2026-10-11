import QRCode from 'react-qr-code';
import { ModalDialog } from './ModalDialog';

interface PlayerQrProps {
  name: string;
  payload: string;
  tagCode: string;
  onClose: () => void;
}

export function PlayerQr({ name, payload, tagCode, onClose }: PlayerQrProps) {
  return (
    <ModalDialog label="My tag QR" onClose={onClose}>
      <div className="modal-card">
        <p className="eyebrow">Runner signal</p>
        <h2>{name}</h2>
        <p>If a catcher gets you, show them this.</p>
        <div className="qr-box">
          <QRCode value={payload} size={240} />
        </div>
        <p className="tag-code" aria-label="Manual tag code">{tagCode}</p>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </ModalDialog>
  );
}
