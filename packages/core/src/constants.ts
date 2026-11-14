/** Protocol constants. Changing any of these changes the on-air format. */
export const PROTOCOL_VERSION = 1;

/** Fountain block size = droplet payload size, in bytes. */
export const BLOCK_SIZE = 16;
/** Maximum number of source blocks per message (4-bit field). */
export const MAX_K = 15;
/** Droplet seeds are 0..MAX_SEED. Seed 255 is reserved. */
export const MAX_SEED = 254;

export const HEADER_LEN = 6;
export const CRC_LEN = 2;
/** header(6) + payload(16) + crc(2) */
export const FRAME_BODY_LEN = HEADER_LEN + BLOCK_SIZE + CRC_LEN; // 24
/** Reed-Solomon parity bytes appended to the frame body. */
export const RS_PARITY_LEN = 8;
/** Bytes actually modulated into sound for one frame. */
export const FRAME_AIR_LEN = FRAME_BODY_LEN + RS_PARITY_LEN; // 32

export const HOP_LIMIT = 8;
export const MSG_TTL_MS = 300_000;

export const MAX_TEXT_CHARS = 140;
export const MAX_ALIAS_CHARS = 8;
/** Envelope = [len 1][flags 1][nonce 4][ciphertext n][tag 8] */
export const ENVELOPE_HEADER_LEN = 6;
export const GCM_TAG_LEN = 8;
export const NONCE_RANDOM_LEN = 4;
export const MAX_ENVELOPE_LEN = MAX_K * BLOCK_SIZE; // 240
export const PBKDF2_SALT = 'birdsong/v1';
export const PBKDF2_ITERATIONS = 100_000;

export const SPECIES_COUNT = 4;
/** Every data chirp sweeps this many semitones above its base pitch. */
export const SWEEP_SEMITONES = 3;
export const DEFAULT_SAMPLE_RATE = 48_000;
