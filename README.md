# Lanyard — Attendee Intelligence

Extract, enrich, and manage event attendee profiles from screenshots or public URLs. Lanyard uses Claude AI vision to read attendee cards from images, Playwright to scrape public speaker pages, and automated Bing searches to find each person's LinkedIn profile and company website.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Local Setup](#local-setup)
5. [Environment Variables](#environment-variables)
6. [Database Migrations](#database-migrations)
7. [API Reference](#api-reference)
8. [Deployment](#deployment)
9. [Software Practices](#software-practices)
10. [Project Structure](#project-structure)

---

## Features

| Feature | How it works |
|---|---|
| **Screenshot extraction** | Upload PNG/JPG screenshots of attendee lists; Claude Haiku vision reads every visible card |
| **URL scraping** | Paste any public speaker/attendee page URL; Playwright navigates and parses the page |
| **LinkedIn enrichment** | Playwright + Bing `site:linkedin.com/in` search finds the exact profile URL per attendee |
| **Company URL enrichment** | Playwright + Bing finds the company's official website, skipping directories and social platforms |
| **Persistent storage** | All attendees are saved to Supabase per user; no re-extraction needed |
| **Search & filter** | Real-time client-side filtering by name, company, title, or location |
| **Auth** | Email/password signup, email confirmation, password reset — all via Supabase Auth |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) |
| Language | TypeScript 5 (strict mode) |
| Styling | Tailwind CSS v4, shadcn/ui |
| Database & Auth | Supabase (PostgreSQL + RLS + GoTrue) |
| AI | Anthropic Claude Haiku 4.5 (vision) |
| Browser automation | Playwright (Chromium) |
| Hosting | Railway (recommended) |

---

## Architecture

```
Browser (React / Next.js client)
  │
  ├─ /attendees page
  │     ├─ Screenshot upload  ──► POST /api/extract-from-image
  │     │                              └─ Claude Haiku vision API
  │     │
  │     ├─ URL input          ──► POST /api/scrape-attendees
  │     │                              └─ Playwright → public page DOM
  │     │
  │     └─ After save         ──► POST /api/find-linkedin        (parallel)
  │                            ── POST /api/find-company-url     (parallel)
  │                                    └─ Playwright → Bing search results
  │
  └─ Supabase (Postgres)
        ├─ auth.users          (managed by Supabase GoTrue)
        ├─ public.profiles     (auto-created on signup via trigger)
        └─ public.attendees    (per-user, RLS enforced)

Auth flow
  Signup/Login ──► Supabase Auth ──► GET /api/auth/callback ──► /dashboard
  Middleware (proxy.ts) guards /dashboard/* and redirects /login when session exists
```

---

## Local Setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- An [Anthropic](https://console.anthropic.com) account with credits
- Playwright Chromium installed locally

### 1. Clone and install

```bash
git clone https://github.com/kalsru/lanyard.git
cd lanyard
npm install
```

### 2. Install Playwright browser

```bash
npx playwright install chromium
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
# Fill in the values — see Environment Variables section below
```

### 4. Run database migrations

In your Supabase project → **SQL Editor**, run each migration file in order:

```
supabase/migrations/20240001_profiles.sql
supabase/migrations/20240002_attendees.sql
supabase/migrations/20240003_company_url.sql
supabase/migrations/20240004_attendees_update_policy.sql
```

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up, confirm your email, and start extracting.

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Yes (safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Yes (safe, RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **No — server only** |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | **No — server only** |
| `PLAYWRIGHT_CHROMIUM_PATH` | Your local Playwright install | No (dev only) |

> **Security:** Never commit `.env.local`. It is in `.gitignore`. On Railway, set these in the Railway dashboard under *Variables*.

> **`PLAYWRIGHT_CHROMIUM_PATH`:** Only needed on Windows dev. On Linux (Railway), omit it — Playwright finds the browser automatically after `playwright install chromium`.

---

## Database Migrations

Migrations live in `supabase/migrations/` and must be run manually in the Supabase SQL Editor (the project does not use the Supabase CLI).

| File | What it does |
|---|---|
| `20240001_profiles.sql` | Creates `profiles` table, RLS policies, signup trigger, updated_at trigger |
| `20240002_attendees.sql` | Creates `attendees` table with RLS for SELECT, INSERT, DELETE |
| `20240003_company_url.sql` | Adds `company_url` column to attendees |
| `20240004_attendees_update_policy.sql` | Adds UPDATE RLS policy + ensures `linkedin_url`/`company_url` columns exist |

**Run them in numeric order.** Each is idempotent (`IF NOT EXISTS`, `OR REPLACE`) so re-running is safe.

### Schema

#### `public.profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, references `auth.users(id)` |
| `email` | text | Copied from auth on signup |
| `full_name` | text | Optional display name |
| `avatar_url` | text | Optional photo |
| `plan` | text | `free` / `pro` / `enterprise` |
| `created_at` | timestamptz | Auto-set |
| `updated_at` | timestamptz | Auto-updated via trigger |

#### `public.attendees`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, auto-generated |
| `user_id` | uuid | FK to `auth.users(id)` |
| `name` | text | Full name |
| `title` | text | Job title / role |
| `company` | text | Organization |
| `company_url` | text | Company website (enriched) |
| `location` | text | City / state |
| `tags` | text[] | Badge labels e.g. `['Speakers']` |
| `avatar_url` | text | Profile photo URL |
| `linkedin_url` | text | LinkedIn profile URL (enriched) |
| `source` | text | Extraction source URL or `screenshot` |
| `created_at` | timestamptz | Auto-set |

---

## API Reference

All routes are under `/api/`. Server routes only — no client-side secrets.

### `POST /api/extract-from-image`

Extract attendee data from one or more screenshots using Claude Haiku vision.

**Request:** `multipart/form-data` with field `images` (one or more image files, max 10 MB each, PNG/JPG/GIF/WebP)

**Response:**
```json
{
  "attendees": [
    {
      "name": "Jane Smith",
      "title": "CTO",
      "company": "Acme Corp",
      "company_url": "https://acme.com",
      "location": "Austin, TX",
      "tags": ["Speakers"],
      "avatar_url": null
    }
  ]
}
```

**Errors:** `400` if no images, unsupported type, or file too large. `200` with `{ error, attendees: [] }` if extraction yields nothing.

---

### `POST /api/scrape-attendees`

Scrape attendee cards from a public URL using Playwright.

**Request:**
```json
{ "url": "https://example.com/speakers" }
```

**Response:** Same shape as `/api/extract-from-image`. Returns `403` if the page redirects to a login screen.

---

### `POST /api/find-linkedin`

Find LinkedIn profile URLs for a list of attendees via Bing search.

**Request:**
```json
{
  "attendees": [
    { "id": "uuid", "name": "Jane Smith", "title": "CTO", "company": "Acme Corp", "location": "Austin, TX" }
  ]
}
```

**Response:**
```json
{
  "results": [
    { "id": "uuid", "linkedin_url": "https://www.linkedin.com/in/janesmith" }
  ]
}
```

`linkedin_url` is `null` when no confident match is found. Processed sequentially (one Playwright instance at a time) to avoid resource exhaustion.

---

### `POST /api/find-company-url`

Find the official company website for a list of attendees via Bing search.

**Request:**
```json
{
  "attendees": [
    { "id": "uuid", "company": "Acme Corp" }
  ]
}
```

**Response:**
```json
{
  "results": [
    { "id": "uuid", "company_url": "https://acme.com" }
  ]
}
```

Returns the domain origin only (e.g. `https://acme.com`, not a deep path). Skips known directories, social platforms, and aggregators.

---

### `GET /api/health`

Liveness probe for Railway / uptime monitors.

**Response:** `{ "status": "ok", "timestamp": "2026-05-01T00:00:00.000Z" }`

---

### `GET /api/auth/callback`

OAuth / email-link exchange endpoint. Supabase redirects here after email confirmation or OAuth login. Not called directly.

---

## Deployment

### Railway (recommended)

Railway provides a full Linux environment where Playwright works without any special configuration. **Vercel is not recommended** — Vercel serverless functions cannot run Playwright (no Chromium binary, 250 MB limit).

#### Steps

1. Push your code to GitHub.
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
3. Select the `lanyard` repository.
4. Add environment variables in Railway → Variables:

   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ANTHROPIC_API_KEY
   ```

   Do **not** set `PLAYWRIGHT_CHROMIUM_PATH` — Railway is Linux and Playwright auto-detects.

5. Railway uses `railway.toml` automatically:
   - Build: `npm ci && npx playwright install chromium --with-deps && npm run build`
   - Start: `npm start`
   - Health check: `GET /api/health`

6. Once deployed, copy the Railway-assigned domain (e.g. `lanyard.up.railway.app`).

7. In Supabase → Authentication → URL Configuration:
   - **Site URL:** `https://lanyard.up.railway.app`
   - **Redirect URLs:** `https://lanyard.up.railway.app/api/auth/callback`

#### Custom domain

In Railway → Settings → Domains, add your custom domain and update the Supabase redirect URLs to match.

---

## Software Practices

### Git workflow

```
main              — production branch, auto-deployed by Railway
  └─ feature/xyz  — one branch per feature or fix, PR into main
```

- Branch names: `feature/`, `fix/`, `chore/`
- Commit messages: imperative present tense — "Add LinkedIn enrichment", "Fix browser cleanup"
- Never force-push `main`
- Open a PR for every change; review before merging

### Environment management

- **`.env.local`** — local secrets, never committed (in `.gitignore`)
- **`.env.example`** — committed, contains placeholder values only
- **Railway Variables** — production secrets, set in the Railway dashboard
- If a secret is ever accidentally committed: rotate the key immediately, then remove it from git history

### Database migrations

- All schema changes go in a new `supabase/migrations/YYYYMMDDNN_description.sql` file
- Every file must be idempotent (`IF NOT EXISTS`, `OR REPLACE`)
- Never edit a migration that has already been applied to production — add a new file instead
- Document each migration in the table above

### Error handling

- All API routes validate input and return structured errors: `{ error: string }` with the correct HTTP status code
- Playwright browsers are always closed in a `finally` block — no leaked processes even on failure
- Per-attendee errors in enrichment are caught individually so one failure does not abort the whole batch

### Logging

All server-side logs use a consistent `[prefix]` format:

| Prefix | Route |
|---|---|
| `[extract]` | `/api/extract-from-image` |
| `[scrape]` | `/api/scrape-attendees` |
| `[linkedin]` | `/api/find-linkedin` |
| `[company-url]` | `/api/find-company-url` |

On Railway, view logs in the dashboard → Deployments → Logs.

### Code style

- TypeScript strict mode enabled (`tsconfig.json`)
- ESLint with `eslint-config-next` — run `npm run lint` before every PR
- Tailwind classes composed via `cn()` from `@/lib/utils`
- No inline comments explaining *what* the code does — only *why* when the reason is non-obvious

### Security checklist

- [x] RLS enabled on all Supabase tables
- [x] `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are server-only
- [x] File uploads validated for type and size before AI processing
- [x] URLs validated before Playwright navigates to them
- [x] No credentials in logs
- [x] `.env.local` in `.gitignore`
- [ ] Rotate API keys if ever accidentally exposed

---

## Project Structure

```
lanyard/
├── .env.example                    # Template — copy to .env.local
├── next.config.ts                  # Marks playwright/sharp as server-external
├── railway.toml                    # Railway build + deploy config
├── supabase/
│   └── migrations/                 # SQL files, run manually in Supabase SQL Editor
│       ├── 20240001_profiles.sql
│       ├── 20240002_attendees.sql
│       ├── 20240003_company_url.sql
│       └── 20240004_attendees_update_policy.sql
└── src/
    ├── app/
    │   ├── layout.tsx              # Root layout (fonts, metadata)
    │   ├── page.tsx                # Root redirect (→ /dashboard or /login)
    │   ├── (auth)/                 # Login, signup, reset-password
    │   ├── (dashboard)/            # Protected pages: dashboard, attendees
    │   └── api/
    │       ├── auth/callback/      # Supabase OAuth / email-link handler
    │       ├── extract-from-image/ # Claude vision extraction
    │       ├── scrape-attendees/   # Playwright URL scraper
    │       ├── find-linkedin/      # Playwright + Bing LinkedIn finder
    │       ├── find-company-url/   # Playwright + Bing company URL finder
    │       └── health/             # Liveness probe
    ├── components/
    │   ├── dashboard/
    │   │   ├── navbar.tsx          # Top nav with user menu
    │   │   └── attendee-card.tsx   # Attendee display card
    │   └── ui/                     # shadcn/ui components
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts           # Browser Supabase client
    │   │   └── server.ts           # Server-side Supabase client (SSR)
    │   └── utils.ts                # cn() class utility
    ├── proxy.ts                    # Auth middleware (session guard)
    └── types/
        └── database.ts             # Supabase table types
```
