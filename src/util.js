// Small shared helpers: JSON responses, error type, input validation.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function readJson(request, maxBytes = 300000) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new HttpError(413, "Request body is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

export function str(value, max, { required = false, label = "Value" } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const out = value.trim();
  if (required && !out) throw new HttpError(400, `${label} is required.`);
  if (out.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
  return out;
}

export function flag(value) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

export function count(value, label = "Quantity") {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new HttpError(400, `${label} must be a whole number from 0 to 9999.`);
  return n;
}

export function nowIso() {
  return new Date().toISOString();
}
