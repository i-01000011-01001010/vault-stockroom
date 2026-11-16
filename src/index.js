// Vault Stockroom Worker entry point.
//   GET  /api/catalog     public, served from a cached one-row snapshot
//   *    /api/admin/*     admin only (Cloudflare Access), see admin.js
//   else                  static files from ./public

import { HttpError, json } from "./util.js";
import { getSnapshotText } from "./db.js";
import { adminRoute } from "./admin.js";

async function publicCatalog(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/api/catalog", request.url));
  const hit = await cache.match(key);
  if (hit) return hit;

  const text = await getSnapshotText(env.DB);
  const res = new Response(text, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      // Visitors may see changes up to a minute late, which keeps database reads tiny.
      "cache-control": "public, max-age=15, s-maxage=60",
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/catalog" && request.method === "GET") {
        return await publicCatalog(request, env, ctx);
      }
      if (url.pathname.startsWith("/api/admin/")) {
        return await adminRoute(request, env, url);
      }
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Not found." }, 404);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong." }, 500);
    }
  },
};
