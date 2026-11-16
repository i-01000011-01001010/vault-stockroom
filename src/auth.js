// Admin authentication. The admin API is protected by Cloudflare Access, and this
// module verifies the signed token Access attaches to every request, so the API
// stays locked even if someone reaches the Worker by a URL that skips Access.
// If Access is not configured, every admin request is refused (fail closed).

import { HttpError } from "./util.js";

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { team: "", at: 0, keys: [] };

function b64urlToBytes(input) {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob((input + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

function cleanTeam(value) {
  return String(value || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

async function loadKeys(team, force) {
  const fresh = jwksCache.team === team && Date.now() - jwksCache.at < JWKS_TTL_MS && jwksCache.keys.length;
  if (fresh && !force) return jwksCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, "Could not load Cloudflare Access signing keys.");
  const body = await res.json();
  jwksCache = { team, at: Date.now(), keys: body.keys || [] };
  return jwksCache.keys;
}

async function verifySignature(token, team) {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new HttpError(401, "Malformed access token.");
  const header = decodeJson(h);
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "Unsupported access token.");

  let keys = await loadKeys(team, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await loadKeys(team, true); // keys rotate, refetch once
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new HttpError(401, "Unknown access token key.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new HttpError(401, "Invalid access token signature.");
  return decodeJson(p);
}

/** Returns { email } for a verified admin, or throws an HttpError. */
export async function requireAdmin(request, env) {
  const url = new URL(request.url);

  // Local development only: wrangler dev on this machine, with DEV_ADMIN=1 in .dev.vars.
  if (env.DEV_ADMIN === "1" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return { email: "dev@localhost" };
  }

  const team = cleanTeam(env.ACCESS_TEAM_DOMAIN);
  const aud = String(env.ACCESS_AUD || "").trim();
  if (!team || !aud) {
    throw new HttpError(503, "Admin is not set up yet. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (see the README).");
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new HttpError(401, "Sign in required.");

  let claims;
  try {
    claims = await verifySignature(token, team);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, "Invalid access token.");
  }

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${team}`) throw new HttpError(401, "Access token issuer mismatch.");
  if (!audiences.includes(aud)) throw new HttpError(403, "Access token is for a different application.");
  if (typeof claims.exp !== "number" || claims.exp < now) throw new HttpError(401, "Access token expired.");
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new HttpError(401, "Access token not yet valid.");

  const email = String(claims.email || "").toLowerCase();
  if (!email) throw new HttpError(403, "Access token has no email.");

  const allow = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length && !allow.includes(email)) throw new HttpError(403, "This account is not allowed to administer this site.");

  return { email };
}

/** Blocks cross-site form posts. Used on every admin write. */
export function requireSameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request blocked.");
  const site = request.headers.get("sec-fetch-site");
  if (!origin && site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site request blocked.");
  if (request.headers.get("x-requested-with") !== "vault-stockroom") throw new HttpError(403, "Missing request header.");
}
