// lib/security.js
// Helmet headers, strict CORS allow-list and a best-effort rate limiter.
import helmet from "helmet";

const helmetMiddleware = helmet({
  // JSON API: nothing should ever be loaded or framed from a response.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  },
  hsts: { maxAge: 63072000, includeSubDomains: true },
  referrerPolicy: { policy: "no-referrer" },
});

// Express-style middleware -> promise
const run = (middleware, req, res) =>
  new Promise((resolve, reject) =>
    middleware(req, res, (err) => (err ? reject(err) : resolve())),
  );

const allowedOrigins = () =>
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Applies Helmet and CORS. Returns false if a browser Origin is present but not allowed.
 * Requests without an Origin header (curl, server-to-server) pass; CORS is a browser
 * control, not bot protection. The honeypot and rate limit cover bots.
 */
export async function applySecurity(req, res) {
  await run(helmetMiddleware, req, res);

  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins().includes(origin)) return false;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

// ---------------------------------------------------------------------------
// Best-effort in-memory rate limit (per warm instance). Add a Vercel Firewall
// rate-limit rule for a real, global limit.
// ---------------------------------------------------------------------------
const hits = new Map(); // ip -> [timestamps]
const MAX_KEYS = 5000;

function clientIp(req) {
  return (
    req.headers["x-real-ip"] ||
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

export function rateLimit(req, { windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    hits.set(ip, recent);
    return {
      limited: true,
      retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(ip, recent);

  if (hits.size > MAX_KEYS) {
    for (const [key, stamps] of hits) {
      if (now - stamps[stamps.length - 1] > windowMs) hits.delete(key);
    }
  }
  return { limited: false };
}
