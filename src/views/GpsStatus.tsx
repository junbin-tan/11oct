import type { GpsStatus as Status } from '../hooks/useGeolocation';

interface GpsStatusProps {
  status: Status;
  onEnable: () => void;
}

export function GpsStatus({ status, onEnable }: GpsStatusProps) {
  switch (status) {
    case 'active':
      return <p className="gps ok">GPS on</p>;
    case 'requesting':
      return <p className="gps">Finding your location…</p>;
    case 'denied':
      return (
        <div className="gps notice">
          <p>Location permission is blocked. Allow location for this site in your browser settings, then retry.</p>
          <button className="btn secondary" onClick={onEnable}>Retry GPS</button>
        </div>
      );
    case 'unavailable':
      return (
        <div className="gps notice">
          <p>No GPS fix yet. Try moving outdoors.</p>
          <button className="btn secondary" onClick={onEnable}>Retry GPS</button>
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
