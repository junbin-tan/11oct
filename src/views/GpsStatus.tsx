import type { GpsStatus as Status } from '../hooks/useGeolocation';

interface GpsStatusProps {
  status: Status;
  onEnable: () => void;
  onResetGps: () => void;
}

export function GpsStatus({ status, onEnable, onResetGps }: GpsStatusProps) {
  switch (status) {
    case 'active':
      return <p className="gps ok">Location shared</p>;
    case 'sharing':
      return <p className="gps">Sharing location…</p>;
    case 'poor':
      return <p className="gps notice">Poor accuracy. Try moving into an open area.</p>;
    case 'aging':
      return <p className="gps notice">Location aging. Finding a fresh reading…</p>;
    case 'connection_lost':
      return <p className="gps notice">Connection lost. Retrying location sharing…</p>;
    case 'paused':
      return <p className="gps notice">Location paused. Keep the game open to share.</p>;
    case 'requesting':
      return <p className="gps">Finding your location…</p>;
    case 'denied':
      return (
        <div className="gps notice">
          <p>Location permission is blocked. Allow location for this site in your browser settings, then retry.</p>
          <div className="gps-actions">
            <button className="btn secondary" onClick={onEnable}>Retry GPS</button>
            <button className="btn secondary" onClick={onResetGps}>Clear GPS cache</button>
          </div>
        </div>
      );
    case 'unavailable':
      return (
        <div className="gps notice">
          <p>No GPS fix yet. Try moving outdoors.</p>
          <div className="gps-actions">
            <button className="btn secondary" onClick={onEnable}>Retry GPS</button>
            <button className="btn secondary" onClick={onResetGps}>Clear GPS cache</button>
          </div>
        </div>
      );
    case 'unsupported':
      return <p className="gps notice">This browser cannot share location. You can still play; the radar won’t show you.</p>;
    default:
      return (
        <button className="btn secondary" onClick={onEnable}>
          Enable GPS
        </button>
      );
  }
}
