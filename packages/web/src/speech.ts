import { hubConfig } from './hub.ts';

/**
 * Speech to text for the message box. The phone records with the node's own microphone and posts the audio to the
 * hub that served the page (POST <hub>/api/transcribe); the hub holds the ElevenLabs key and returns the words.
 * Pages not served by a hub (GitHub Pages, a bird's own page) find no hub and show no microphone button.
 */

/** Longest dictation. The node is deaf to chirps while it records, so a forgotten recording must end by itself. */
export const MAX_DICTATION_MS = 30_000;

/** Whether the hub at `base` can turn speech into text (it has an ElevenLabs key). Any failure means no. */
export async function speechAvailable(base: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  return (await hubConfig(base, fetchFn))?.speechToText === true;
}

/** Sends recorded audio to the hub and returns the words, or throws with a message for the person. */
export async function transcribe(base: string, audio: Blob, fetchFn: typeof fetch = fetch): Promise<string> {
  let r: Response;
  try {
    r = await fetchFn(new URL('api/transcribe', base).href, {
      method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio,
    });
  } catch {
    throw new Error('Cannot reach the computer for speech to text. Type the message instead.');
  }
  const body = (await r.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
  if (!r.ok || typeof body.text !== 'string' || body.text === '') {
    throw new Error(typeof body.error === 'string' ? body.error : `Speech to text failed (HTTP ${r.status}).`);
  }
  return body.text;
}

/** The message box after dictation: the heard words go after what is there, cut to `max` characters. */
export function appendDictation(current: string, heard: string, max: number): string {
  const head = current.trim();
  const joined = head ? `${head} ${heard.trim()}` : heard.trim();
  return [...joined].slice(0, max).join('');
}
