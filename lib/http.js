// lib/http.js
// Consistent JSON responses.

export function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

export function sendError(
  res,
  status,
  code,
  message,
  { details, requestId } = {},
) {
  res.status(status).json({
    error: { code, message, ...(details ? { details } : {}), requestId },
  });
}

/** Zod issues -> [{ path: 'children.0.mobile', message }]. Never echoes input values. */
export const formatIssues = (zodError) =>
  zodError.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
