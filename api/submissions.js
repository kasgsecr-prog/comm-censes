// api/submissions.js
// POST /api/submissions: the ONLY endpoint. Create-only; every other method -> 405.
import { randomUUID } from "node:crypto";
import { submissionSchema } from "../shared/schema.js";
import { insertSubmission } from "../lib/repository.js";
import { applySecurity, rateLimit } from "../lib/security.js";
import { sendError, sendJson, formatIssues } from "../lib/http.js";
import { newReferenceNo } from "../lib/reference.js";
import { log } from "../lib/logger.js";

const MAX_BODY_BYTES = 32 * 1024;

export default async function handler(req, res) {
  const requestId = randomUUID();
  const started = Date.now();
  const fail = (status, code, message, details) => {
    log("warn", "request_rejected", {
      requestId,
      status,
      code,
      ms: Date.now() - started,
    });
    return sendError(res, status, code, message, { details, requestId });
  };

  res.setHeader("X-Request-Id", requestId);
  res.setHeader("Cache-Control", "no-store");

  try {
    // 1. Security headers + CORS allow-list
    const originAllowed = await applySecurity(req, res);
    if (!originAllowed)
      return fail(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed.");

    // 2. Method handling (preflight, then POST only)
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return fail(
        405,
        "METHOD_NOT_ALLOWED",
        "Only POST is supported on this endpoint.",
      );
    }

    // 3. Rate limit (best-effort; see README / Vercel Firewall)
    const rl = rateLimit(req);
    if (rl.limited) {
      res.setHeader("Retry-After", String(rl.retryAfter));
      return fail(
        429,
        "RATE_LIMITED",
        "Too many requests. Please try again later.",
      );
    }

    // 4. Content negotiation + size guard
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      return fail(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type must be application/json.",
      );
    }
    if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) {
      return fail(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    }

    let body;
    try {
      body = req.body;
    } catch {
      return fail(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail(400, "INVALID_JSON", "Request body must be a JSON object.");
    }

    // 5. Honeypot: bots fill hidden fields. Pretend success, store nothing.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      log("warn", "honeypot_triggered", { requestId });
      return sendJson(res, 201, {
        data: { referenceNo: newReferenceNo(), duplicate: false },
      });
    }

    // 6. Validate + sanitise (same Zod schema as the frontend)
    const parsed = submissionSchema.safeParse(body);
    if (!parsed.success) {
      return fail(
        422,
        "VALIDATION_ERROR",
        "Some fields are invalid.",
        formatIssues(parsed.error),
      );
    }

    // 7. One atomic transaction
    const { referenceNo, duplicate } = await insertSubmission(parsed.data);
    const status = duplicate ? 200 : 201;
    log("info", "submission_stored", {
      requestId,
      status,
      ms: Date.now() - started,
    });
    return sendJson(res, status, { data: { referenceNo, duplicate } });
  } catch (err) {
    // Never log err.message / err.detail: Postgres may echo row data.
    const pgCode = typeof err?.code === "string" ? err.code : undefined;
    let status = 500;
    let code = "INTERNAL_ERROR";
    let message = "Something went wrong. Please try again.";

    if (pgCode === "23514") {
      status = 422;
      code = "CONSISTENCY_ERROR";
      message = "The submission failed data consistency checks.";
    } else if (pgCode && /^(08|53|57)/.test(pgCode)) {
      status = 503;
      code = "SERVICE_UNAVAILABLE";
      message =
        "The service is temporarily unavailable. Please try again shortly.";
      res.setHeader("Retry-After", "5");
    }

    log("error", "request_failed", {
      requestId,
      status,
      code,
      pgCode,
      ms: Date.now() - started,
    });
    return sendError(res, status, code, message, { requestId });
  }
}
