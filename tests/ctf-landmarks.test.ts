import { expect, it, vi } from 'vitest';
import { LandmarkLookup } from '../server/ctf/landmarks.js';

const start = { lat: 1.3, lng: 103.8 };
it('filters restricted, distant, invalid and overlapping points and caches the result', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [
    { tags: { name: 'Fountain' }, lat: 1.3004, lon: 103.8 },
    { tags: { name: 'Duplicate' }, lat: 1.3004, lon: 103.8 },
    { tags: { name: 'Private', access: 'private' }, lat: 1.2996, lon: 103.8 },
    { tags: { name: 'Inside', indoor: 'yes' }, lat: 1.2996, lon: 103.8 },
    { tags: { name: 'Far away' }, lat: 1.4, lon: 103.8 },
    { tags: { name: 'Bad' }, lat: '1.3', lon: 103.8 },
    { tags: { name: 'Memorial' }, center: { lat: 1.2996, lon: 103.8 } },
  ] })));
  const lookup = new LandmarkLookup('https://example.test/overpass', fetcher);
  const result = await lookup.find(start);
  expect(result.unavailable).toBe(false);
  expect(result.suggestions.map(x => x.name).sort()).toEqual(['Duplicate', 'Memorial']);
  expect(await lookup.find(start)).toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
});
it.each(['network', 'http', 'invalid'])('falls back to manual placement on %s failure', async failure => {
  const fetcher = vi.fn();
  if (failure === 'network') fetcher.mockRejectedValue(new Error('offline'));
  else fetcher.mockResolvedValue(failure === 'http' ? new Response('', { status: 429 }) : new Response('{}'));
  const lookup = new LandmarkLookup('https://example.test', fetcher);
  expect(await lookup.find(start)).toEqual({ unavailable: true, suggestions: [] });
  expect(await lookup.find(start)).toEqual({ unavailable: true, suggestions: [] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('allows discovery to be disabled and expires cache entries', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response('{"elements":[]}'));
  expect(await new LandmarkLookup('', fetcher).find(start)).toEqual({ unavailable: true, suggestions: [] });
  expect(fetcher).not.toHaveBeenCalled();
  let clock = 1;
  const lookup = new LandmarkLookup('https://example.test', fetcher, () => clock);
  await lookup.find(start); clock += 300_001; await lookup.find(start);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
