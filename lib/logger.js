// lib/logger.js
// PII-safe logger: only allow-listed keys are ever written.
// Never pass request bodies or database error messages to this function.
const SAFE_KEYS = new Set(["requestId", "status", "code", "pgCode", "ms"]);

export function log(level, event, fields = {}) {
  const safe = {};
  for (const key of Object.keys(fields)) {
    if (SAFE_KEYS.has(key)) safe[key] = fields[key];
  }
  const line = JSON.stringify({ level, event, ...safe });
  (level === "error" ? console.error : console.log)(line);
}
