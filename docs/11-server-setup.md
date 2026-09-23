# 11 · Setting up the company server (plain English)

Buildline needs one server that every iPad, phone and laptop talks to. This is
the part that turns the demo into the real thing for R. P. Valois & Co.
Expect about an hour the first time. `08-deployment.md` has the technical
version of the same information.

## Pick a home for it

Any of these works for one company. Costs are rough monthly figures.

| Option | Cost | Good for |
|---|---|---|
| **Railway** or **Render** | about $20 to $30 | Easiest. Connect the GitHub repository, add a Postgres database with one click, set the settings below, done. Updates deploy when you push. |
| **Fly.io** | about $10 to $20 | Slightly more command-line, cheapest, good backups. |
| **A small VPS** (DigitalOcean, Hetzner, Linode) | about $12 to $24 | Full control; you run Postgres and backups yourself. |
| **A Mac or PC in the office** | free | Works on the office Wi-Fi only unless you add a tunnel (Tailscale or Cloudflare Tunnel). Fine to start; not for clients' portal access. |

Whatever you pick, you need three things: the app running, a PostgreSQL
database, and an HTTPS address (a domain such as `buildline.rpvalois.com`).
Railway, Render and Fly give you the address and the certificate
automatically. On a VPS, put Caddy in front of the app and it handles HTTPS
for you.

## Settings the server needs

These are the "environment variables". Copy `apps/api/.env.example` and fill
in:

| Setting | What to put |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the Postgres connection string your host gives you |
| `APP_SECRET` | a long random string (40+ characters). Generate one with `openssl rand -hex 32`. Never change it after go-live: it signs file links. |
| `API_URL` and `APP_URL` | your HTTPS address, e.g. `https://buildline.rpvalois.com` |
| `CORS_ORIGINS` | the same address plus `capacitor://localhost` (the installed app) |
| `SERVE_CLIENT_DIR` | `apps/ipad/dist` so the server also serves the app for browsers |
| `STORAGE_DRIVER` | `local` to keep uploaded photos and documents on the server's disk (make sure the disk is persistent and backed up), or `s3` with a bucket for anything larger. |
| `EMAIL_DRIVER` and `SMTP_URL` | `smtp` and the address from your email provider (Postmark, SendGrid, Google Workspace SMTP, Mailgun). Without this, invitations and reminders are only written to the log. |
| `PAYMENTS_DRIVER` | `none` to start. Online invoice payment needs a Stripe account; ask when you want that turned on. |
| `ANTHROPIC_API_KEY` | optional. With it the assistant answers in natural language; without it the built-in understanding still works. |

## First run

```bash
pnpm install
pnpm --filter @buildline/ipad build
pnpm --filter @buildline/api db:migrate
pnpm --filter @buildline/api start
```

Railway and Render run these for you from `package.json`. Then open your
address in a browser and choose **Create a company**. The first account
becomes the owner. Do **not** run the demo seed on the real server.

## Setting up the company (about 30 minutes)

1. **Settings → Company**: name, address, logo, working days, tax rate.
2. **Settings → Roles**: the eight standard roles are already there. Adjust
   who can see money if needed.
3. **Settings → Members**: invite each person with the right role. Field
   staff get Field Supervisor or Field Crew; the office gets Office / Finance;
   estimators get Estimator. Each gets an email with a link.
4. **Vendors** and **Clients**: add the regulars, or import later from a
   spreadsheet (send it over and it can be loaded in bulk).
5. **Settings → Automations**: turn on the ready-made rules you want, such as
   "invoice overdue → follow up".
6. Create the first real project, add the standard selections sheet from the
   Selections tab, and invite the homeowner to the portal from the Clients
   page.

## Keeping it healthy

* **Backups.** Managed Postgres (Railway, Render, Fly, DigitalOcean) has
  daily backups switched on by default; check it once. On a VPS, schedule
  `pg_dump` nightly to somewhere off the machine. Uploaded files live in the
  storage folder or bucket; back that up too.
* **Updates.** Pull the latest code, rebuild, run `db:migrate`, restart. The
  database migrations are safe to run again.
* **Who can reach it.** The server is on the internet so the homeowner portal
  works from home. Every screen needs a sign-in, every record is tied to the
  company, and the database enforces that separately. If you would rather it
  be office-only for now, skip the domain and use Tailscale.
* **If something breaks.** The server writes a log; on Railway/Render/Fly it
  is one click away. Copy the last lines and send them over.
