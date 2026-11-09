// lib/reference.js
// Random, non-sequential reference number, e.g. KA-7H3K9QWD.
// Alphabet has no 0/1/I/L/O. Must match ck_submission_reference in the DB.
import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newReferenceNo() {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return `KA-${out}`;
}
