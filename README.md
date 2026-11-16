# Vault Stockroom

A free, self-hosted trade and collection board for Fallout 76 players. List the plans you have learned, choose what you are offering, and let other players browse it. It is for in-game trading only. It never handles real money and it is not affiliated with Bethesda.

This is the database version. It runs entirely on Cloudflare's free plan: a Worker, a D1 database, and Cloudflare Access for the admin login. There is also a no-database "lite" version on the `static` branch.

## What you get

- Public catalog with search, a request builder, and five themes (Amber Phosphor, Green Phosphor, Daybreak, Gunmetal, Auto).
- Admin page with learned and offering checkboxes, section on/off switches, site settings, your own custom items, export and import, and an activity log.
- A first-visit notice that the site is for in-game trading only.

## Set up

You need a free Cloudflare account and Node 20 or newer.

1. **Fork or clone** this repo, then run `npm install`.
2. **Create the database:** `npx wrangler d1 create vault-stockroom`. Copy the `database_id` it prints into `wrangler.toml`.
3. **Create the tables and load the catalog:** `npm run db:migrate:remote`.
4. **Deploy:** `npm run deploy`. Note your `*.workers.dev` address.
5. **Lock the admin.** In the Cloudflare dashboard open Zero Trust, then Access, then Applications, and add a self-hosted application covering these two paths on your site:
   - `/admin*`
   - `/api/admin/*`

   Allow only your own login (GitHub or Google, ideally with a passkey). Copy the application's **Audience (AUD) tag** and your **team domain** (for example `yourteam.cloudflareaccess.com`).
6. **Tell the Worker about it:** put those two values in `wrangler.toml` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, optionally list your email in `ADMIN_EMAILS`, and deploy again.

The Worker checks Access's signed token itself, so the admin API stays locked even if someone finds a way around Access. If those two values are not set, the admin refuses everyone.

Then open `/admin.html`, fill in the **Site** tab, and tick what you have learned and are offering.

## Automatic deploys (optional)

Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets. Pushes to `main` then run the database migrations and deploy.

## Local development

Copy `.dev.vars.example` to `.dev.vars`, then:

```
npm run db:migrate:local
npm run dev
```

`DEV_ADMIN=1` lets you into the admin on `localhost` only. Never put it in production. `npm test` runs the admin login checks.

## Free plan limits

The public page reads one cached row, so visitors cost almost nothing against the database. Cloudflare's free plan stops serving a site if its daily quota runs out, so keep an eye on the dashboard if you share the link widely.

## Credits and license

MIT licensed, see `LICENSE`. Project by [i-01000011-01001010](https://i-01000011-01001010.dev/).
