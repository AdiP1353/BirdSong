/**
 * The dashboard hub behind this page, when there is one. The hub serves the phone app at <hub>/app/; the phone uses
 * it for two things only: speech to text (POST /api/transcribe) and the observer link that puts the phone on the
 * dashboard (WebSocket /node). Messages never go this way: they travel as sound. A page with no hub (GitHub Pages,
 * a bird's own page) does neither.
 */

export interface HubConfig {
  /** The hub has an ElevenLabs key (the 🎤 button). */
  speechToText?: boolean;
}

/** Base URL of the hub behind this page, ending in '/'. The phone app lives at <hub>/app/, so the hub is one level up. */
export function hubBase(href: string): string {
  const dir = new URL('.', href);
  dir.search = '';
  dir.hash = '';
  if (dir.pathname.endsWith('/app/')) dir.pathname = dir.pathname.slice(0, -'app/'.length);
  return dir.href;
}

/** The hub's /config.json, or null when no hub answers (any failure). */
export async function hubConfig(base: string, fetchFn: typeof fetch = fetch): Promise<HubConfig | null> {
  try {
    const r = await fetchFn(new URL('config.json', base).href);
    if (!r.ok) return null;
    const c = (await r.json()) as unknown;
    return typeof c === 'object' && c !== null ? (c as HubConfig) : null;
  } catch {
    return null;
  }
}

/** WebSocket base for the hub (https -> wss), without a trailing '/'; the observer link adds /node. */
export function hubSocketBase(base: string): string {
  return base.replace(/^http/, 'ws').replace(/\/+$/, '');
}
