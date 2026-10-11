import { CTF, distance } from './rules.js';
import type { Landmark, LandmarkResult, Position } from './types.js';

interface Element { tags?: Record<string, string>; lat?: number; lon?: number; center?: { lat: number; lon: number } }

export class LandmarkLookup {
  private cache = new Map<string, { until: number; result: Promise<LandmarkResult> }>();
  constructor(private endpoint = process.env.CTF_OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter',
    private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}

  async find(start: Position): Promise<LandmarkResult> {
    const key = `${start.lat},${start.lng}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > this.now()) return cached.result;
    // Coalesce in-flight requests and cache failures too; manual placement is always available.
    const result = this.query(start);
    for (const [k, value] of this.cache) if (value.until <= this.now()) this.cache.delete(k);
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { until: this.now() + 5 * 60_000, result });
    return result;
  }
  private async query(start: Position): Promise<LandmarkResult> {
    if (!this.endpoint) return { suggestions: [], unavailable: true };
    const near = `(around:85,${start.lat},${start.lng})`;
    const query = `[out:json][timeout:5];(
      nwr${near}[name][tourism~"^(artwork|viewpoint|attraction)$"];
      nwr${near}[name][historic~"^(monument|memorial)$"];
      nwr${near}[name][leisure~"^(park|garden|playground)$"];
      nwr${near}[name][amenity~"^(fountain|clock|drinking_water|shelter)$"];
    );out center 60;`;
    try {
      const response = await this.fetcher(this.endpoint, { method: 'POST', body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(8_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!response.ok) throw new Error('Landmark service unavailable');
      const data = await response.json() as { elements?: Element[] };
      if (!Array.isArray(data.elements)) throw new Error('Invalid landmark response');
      const candidates: Landmark[] = [];
      for (const item of data.elements.slice(0, 60)) {
        const tags = item.tags, lat = item.lat ?? item.center?.lat, lng = item.lon ?? item.center?.lon;
        if (!tags?.name || ['private', 'no', 'customers', 'permit'].includes(tags.access ?? '')
          || tags.indoor === 'yes' || tags.construction || typeof lat !== 'number' || typeof lng !== 'number'
          || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        const point = { lat, lng, name: tags.name.slice(0, 80) };
        if (distance(start, point) <= CTF.checkpointLimit) candidates.push(point);
      }
      candidates.sort((a, b) => distance(start, a) - distance(start, b) || a.name.localeCompare(b.name));
      const suggestions: Landmark[] = [];
      for (const item of candidates) {
        if (suggestions.every(other => distance(item, other) > CTF.spacing)) suggestions.push(item);
        if (suggestions.length === 3) break;
      }
      return { suggestions, unavailable: false };
    } catch { return { suggestions: [], unavailable: true }; }
  }
}
