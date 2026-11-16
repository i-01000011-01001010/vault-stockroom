// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireAdmin, requireSameOrigin } from "../src/auth.js";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "aud-tag-123";

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const enc = (obj) => b64(JSON.stringify(obj));

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1", alg: "RS256", use: "sig" };

globalThis.fetch = async (url) => {
  assert.equal(String(url), `https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
};

async function token(overrides = {}, { tamper = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://${TEAM}`, aud: [AUD], email: "Owner@Example.com", exp: now + 300, iat: now, ...overrides };
  const head = enc({ alg: "RS256", kid: "k1", typ: "JWT" });
  const body = enc(payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
  const finalBody = tamper ? enc({ ...payload, email: "evil@example.com" }) : body;
  return `${head}.${finalBody}.${b64(sig)}`;
}

const req = (tok, url = "https://stock.example.com/api/admin/data") =>
  new Request(url, { headers: tok ? { "Cf-Access-Jwt-Assertion": tok } : {} });
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "" };

async function status(promise) {
  try {
    await promise;
    return 200;
  } catch (e) {
    return e.status;
  }
}

test("accepts a valid token and lowercases the email", async () => {
  const r = await requireAdmin(req(await token()), env);
  assert.equal(r.email, "owner@example.com");
});

test("refuses when Access is not configured (fail closed)", async () => {
  assert.equal(await status(requireAdmin(req(await token()), { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" })), 503);
});

test("refuses a missing token", async () => {
  assert.equal(await status(requireAdmin(req(null), env)), 401);
});

test("refuses a tampered payload", async () => {
  assert.equal(await status(requireAdmin(req(await token({}, { tamper: true })), env)), 401);
});

test("refuses a wrong audience", async () => {
  assert.equal(await status(requireAdmin(req(await token({ aud: ["other"] })), env)), 403);
});

test("refuses a wrong issuer", async () => {
  assert.equal(await status(requireAdmin(req(await token({ iss: "https://evil.cloudflareaccess.com" })), env)), 401);
});

test("refuses an expired token", async () => {
  assert.equal(await status(requireAdmin(req(await token({ exp: Math.floor(Date.now() / 1000) - 10 })), env)), 401);
});

test("enforces the optional email allow list", async () => {
  const t = await token();
  assert.equal(await status(requireAdmin(req(t), { ...env, ADMIN_EMAILS: "someone@else.com" })), 403);
  assert.equal(await status(requireAdmin(req(t), { ...env, ADMIN_EMAILS: "OWNER@example.com, x@y.z" })), 200);
});

test("DEV_ADMIN only bypasses on localhost", async () => {
  const dev = { ...env, DEV_ADMIN: "1" };
  assert.equal((await requireAdmin(req(null, "http://localhost:8787/api/admin/data"), dev)).email, "dev@localhost");
  assert.equal(await status(requireAdmin(req(null, "https://stock.example.com/api/admin/data"), dev)), 401);
});

test("same-origin check blocks cross-site writes", () => {
  const mk = (headers) => new Request("https://stock.example.com/api/admin/state", { method: "POST", headers });
  const good = { origin: "https://stock.example.com", "x-requested-with": "vault-stockroom" };
  assert.doesNotThrow(() => requireSameOrigin(mk(good)));
  assert.throws(() => requireSameOrigin(mk({ ...good, origin: "https://evil.example" })), /Cross-site/);
  assert.throws(() => requireSameOrigin(mk({ "x-requested-with": "vault-stockroom", "sec-fetch-site": "cross-site" })), /Cross-site/);
  assert.throws(() => requireSameOrigin(mk({ origin: "https://stock.example.com" })), /Missing request header/);
});
