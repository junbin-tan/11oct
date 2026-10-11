import QRCode from 'react-qr-code';

interface PlayerQrProps {
  name: string;
  payload: string;
  tagCode: string;
  onClose: () => void;
}

export function PlayerQr({ name, payload, tagCode, onClose }: PlayerQrProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="My tag QR">
      <div className="modal-card">
        <h2>{name}</h2>
        <p>If a catcher gets you, show them this.</p>
        <div className="qr-box">
          <QRCode value={payload} size={240} />
        </div>
        <p className="tag-code" aria-label="Manual tag code">{tagCode}</p>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
