/**
 * Random, non-sequential IDs for every record (PRD §10 conventions).
 * Format: 21 URL-safe characters (~126 bits of randomness).
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

export function newId(size = 21): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte & 63];
  return id;
}

/** Current time as the ISO-8601 UTC string the database stores. */
export function nowIso(): string {
  return new Date().toISOString();
}
