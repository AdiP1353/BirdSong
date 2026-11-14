import { describe, it } from 'vitest';

// enable when plan 003 is DONE
// Plan 006 Step 3: at 48 000 Hz, for jungle/coast/city x both profiles, embed 10 modem frames of
// random bytes in 1 s of silence, add renderAmbient scaled to RMS 2 x AMBIENT_LEVEL[env] x the
// signal RMS plus white noise at 15 dB SNR, push through a fresh modem, and require >= 9 of 10
// frames with at most 4 wrong bytes.
describe.skip('ambient does not disturb the modem', () => {
  it.skip('decodes at least 9 of 10 frames under 2x ambient level (jungle, coast, city x stealth, fast)', () => {});
});
