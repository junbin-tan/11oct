/** Sensor-only boundary: native providers can supply the same readings without changing delivery. */
export interface LocationReading {
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: number;
}

export interface LocationProvider {
  supported(): boolean;
  watch(onReading: (reading: LocationReading) => void, onError: (reason: 'denied' | 'unavailable') => void): () => void;
  acquire(onReading: (reading: LocationReading) => void, onError: (reason: 'denied' | 'unavailable') => void): void;
}

const options: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };
const reading = (position: GeolocationPosition): LocationReading => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
  accuracy: Number.isFinite(position.coords.accuracy) && position.coords.accuracy >= 0 ? position.coords.accuracy : null,
  capturedAt: position.timestamp,
});
const reason = (error: GeolocationPositionError) => error.code === 1 ? 'denied' as const : 'unavailable' as const;

export const browserLocationProvider: LocationProvider = {
  supported: () => typeof navigator !== 'undefined' && typeof navigator.geolocation?.watchPosition === 'function',
  watch(onReading, onError) {
    const id = navigator.geolocation.watchPosition((p) => onReading(reading(p)), (e) => onError(reason(e)), options);
    return () => navigator.geolocation.clearWatch(id);
  },
  acquire(onReading, onError) {
    navigator.geolocation.getCurrentPosition((p) => onReading(reading(p)), (e) => onError(reason(e)), options);
  },
};
