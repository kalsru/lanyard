# Lanyard — Setup & Development Guide

A SaaS web application built with Next.js 16, Supabase, TypeScript, Tailwind CSS, and shadcn/ui.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui |
| Backend / Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Real-time | Supabase Realtime |
| File Storage | Supabase Storage |
| Edge Functions | Supabase Edge Functions |

---

## Prerequisites

Before starting, install:

1. **Node.js LTS** — https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`)
2. **Git** — https://git-scm.com

Verify both are installed:
```bash
node -v   # should print v20.x.x or higher
npm -v    # should print 10.x.x or higher
git -v    # should print git version x.x.x
```

---

## Project Setup (Already Done)

These steps were completed during project scaffolding. They are documented here for reference.

### Step 1 — Create the Next.js App

```bash
npx create-next-app@latest lanyard \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbopack
```

### Step 2 — Install Supabase Packages

```bash
cd lanyard
npm install @supabase/supabase-js @supabase/ssr
```

### Step 3 — Initialize shadcn/ui

```bash
npx shadcn@latest init --defaults
```

### Step 4 — Add shadcn Components

```bash
npx shadcn@latest add card input label sonner dropdown-menu avatar badge separator
```

### Step 5 — Fix PowerShell Execution Policy (Windows only)

If you get a "script is not digitally signed" error:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
```

---

## Project Structure

```
lanyard/
├── src/
│   ├── app/
│   │   ├── (auth)/                    # Auth route group (no shared layout)
│   │   │   ├── login/page.tsx         # /login
│   │   │   ├── signup/page.tsx        # /signup
│   │   │   └── reset-password/        # /reset-password
│   │   │       └── page.tsx
│   │   ├── (dashboard)/               # Protected route group
│   │   │   └── dashboard/page.tsx     # /dashboard
│   │   ├── api/
│   │   │   └── auth/
│   │   │       └── callback/
│   │   │           └── route.ts       # OAuth & magic link callback
│   │   ├── layout.tsx                 # Root layout
│   │   └── page.tsx                   # Root → redirects to /login or /dashboard
│   ├── components/
│   │   ├── dashboard/
│   │   │   └── navbar.tsx             # Top navigation bar
│   │   └── ui/                        # shadcn components (auto-generated)
│   ├── lib/
│   │   └── supabase/
│   │       ├── client.ts              # Browser-side Supabase client
│   │       └── server.ts              # Server-side Supabase client (SSR)
│   ├── proxy.ts                       # Auth guard (replaces middleware in Next.js 16)
│   └── types/
│       └── database.ts                # Supabase database type definitions
├── supabase/
│   └── migrations/
│       └── 20240001_profiles.sql      # Profiles table + RLS + triggers
├── .env.local                         # Environment variables (never commit this)
├── SETUP.md                           # This file
└── package.json
```

---

## Environment Variables

The file `.env.local` in the project root holds your secrets. It is never committed to Git.

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

**Where to find these values:** Supabase Dashboard → your project → Settings → API

- `NEXT_PUBLIC_SUPABASE_URL` → "Project URL"
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → "Project API keys" → anon / public
- `SUPABASE_SERVICE_ROLE_KEY` → "Project API keys" → service_role ⚠️ keep secret

> Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser.  
> `SUPABASE_SERVICE_ROLE_KEY` is server-only and bypasses Row Level Security — never expose it client-side.

---

## Supabase Project Setup

### Step 1 — Create a Supabase Project

1. Go to https://supabase.com and sign in (or create a free account)
2. Click **New project**
3. Name it `lanyard`, choose a region close to you, set a database password
4. Wait ~2 minutes for the project to provision

### Step 2 — Copy API Keys

1. In your project, go to **Settings → API**
2. Copy the three values into `.env.local` (see above)

### Step 3 — Run the Database Migration

1. In your Supabase project, go to **SQL Editor**
2. Click **New query**
3. Copy the entire contents of `supabase/migrations/20240001_profiles.sql`
4. Paste it into the editor and click **Run**

This migration creates:
- `public.profiles` table — stores user display info and plan tier
- Row Level Security (RLS) policies — users can only read/update their own profile
- `handle_new_user` trigger — auto-creates a profile row when a user signs up
- `handle_updated_at` trigger — keeps `updated_at` current on every update

### Step 4 — Configure Auth Settings (Optional but Recommended)

In Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` (for development)
- **Redirect URLs**: add `http://localhost:3000/api/auth/callback`

For production, add your deployed domain here as well.

---

## Running the App Locally

```bash
# From the lanyard/ directory
npm run dev
```

Open http://localhost:3000 — you will be redirected to `/login`.

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server (after build) |
| `npm run lint` | Run ESLint |
| `npx tsc --noEmit` | Type-check without building |

---

## How Authentication Works

```
User visits /          →  proxy.ts checks session
  Logged in?           →  redirect to /dashboard
  Not logged in?       →  redirect to /login

User visits /dashboard →  proxy.ts checks session
  No session?          →  redirect to /login

User signs up          →  email confirmation sent
  Clicks email link    →  /api/auth/callback exchanges code for session
  Session created      →  redirect to /dashboard
  Supabase trigger     →  auto-creates row in public.profiles
```

### Key Files

| File | Purpose |
|------|---------|
| `src/proxy.ts` | Runs on every request. Redirects unauthenticated users away from `/dashboard`. Redirects logged-in users away from auth pages. |
| `src/lib/supabase/client.ts` | Creates a Supabase client for use in Client Components (`'use client'`). Must only be called inside event handlers, not at component render level, to avoid build-time errors. |
| `src/lib/supabase/server.ts` | Creates a Supabase client for Server Components and Route Handlers. Uses Next.js `cookies()` to manage the session. |
| `src/app/api/auth/callback/route.ts` | Receives the `?code=` param from Supabase email links and OAuth, exchanges it for a session, and redirects to `/dashboard`. |

---

## Database Schema

### `public.profiles`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | References `auth.users(id)` — primary key |
| `email` | `text` | User's email address |
| `full_name` | `text` | Display name (optional) |
| `avatar_url` | `text` | Profile picture URL (optional) |
| `plan` | `text` | Subscription tier: `free`, `pro`, or `enterprise` |
| `created_at` | `timestamptz` | Account creation time |
| `updated_at` | `timestamptz` | Last profile update time |

### Row Level Security

Users can only query and update their own profile row. No user can read another user's data.

---

## Pages & Routes

| Route | File | Auth Required | Description |
|-------|------|---------------|-------------|
| `/` | `src/app/page.tsx` | — | Redirects based on session |
| `/login` | `src/app/(auth)/login/page.tsx` | No | Email + password sign in |
| `/signup` | `src/app/(auth)/signup/page.tsx` | No | Create new account |
| `/reset-password` | `src/app/(auth)/reset-password/page.tsx` | No | Send password reset email |
| `/dashboard` | `src/app/(dashboard)/dashboard/page.tsx` | Yes | Main app screen |
| `/api/auth/callback` | `src/app/api/auth/callback/route.ts` | — | Auth redirect handler |

---

## Features Completed

- [x] Project scaffold (Next.js 16 + TypeScript + Tailwind v4)
- [x] shadcn/ui component library
- [x] Supabase client (browser + server)
- [x] Auth proxy (route protection)
- [x] Login page
- [x] Signup page (with email confirmation flow)
- [x] Reset password page
- [x] OAuth callback handler
- [x] Dashboard page (server-rendered, auth-protected)
- [x] Navbar with user avatar + sign out
- [x] Profiles table migration with RLS and auto-create trigger
- [x] Full TypeScript types for the database schema

## Features Planned

- [ ] Real-time subscriptions (Supabase Realtime)
- [ ] File uploads (Supabase Storage)
- [ ] Edge Functions
- [ ] Profile settings page
- [ ] Billing / plan upgrade (Stripe integration)
- [ ] Team / organization support
- [ ] OAuth providers (Google, GitHub)

---

## Common Issues

### `npx: command not found` in bash terminal
Node.js is installed but the terminal was opened before the install. Close and reopen the terminal, then try again.

### `script is not digitally signed` in PowerShell
Run this once to allow local scripts:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
```

### `Invalid supabaseUrl` during build
Your `.env.local` still has placeholder values. Add your real Supabase project URL and keys.

### Login redirects back to `/login`
The Supabase URL or keys in `.env.local` are wrong, or you haven't run the SQL migration yet.

### Profile is `null` after login
The `handle_new_user` trigger did not fire. Re-run the migration SQL in the Supabase SQL Editor to create the trigger, then sign up with a new account.

---

## Deployment (Vercel)

1. Push the project to a GitHub repository
2. Go to https://vercel.com → Import the repository
3. Add all three environment variables from `.env.local` in Vercel's project settings
4. Deploy — Vercel auto-detects Next.js and configures everything
5. In Supabase Dashboard → Authentication → URL Configuration, add your Vercel domain to Site URL and Redirect URLs
