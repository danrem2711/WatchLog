# WatchLog – Movie & Series Tracker

Vanilla HTML/CSS/JS frontend, a Node serverless API, a Turso (hosted SQLite) database and live data from [TMDB](https://www.themoviedb.org/).

## Features
- Accounts (scrypt-hashed passwords, HttpOnly session cookie)
- Discover and search movies and series; add to your list with status, 1–10 rating, episode progress and review
- Watchlist with status tabs, filters and sorting; stats dashboard; personalised recommendations
- Admin dashboard (the **first account registered becomes admin**): overview cards and charts, user management (search, filter, promote/demote, ban/unban, delete), review moderation

## Environment variables
| Name | Where to get it |
|---|---|
| `TMDB_API_KEY` | themoviedb.org → Settings → API (v3 key or v4 token) |
| `DATABASE_URL` | Supabase → **Connect** → **Transaction pooler** URI (replace `[YOUR-PASSWORD]`) |

(The Supabase integration in the Vercel Marketplace sets `POSTGRES_URL`, which the code also accepts.)

## Run locally
```
npm install
```
Create `.env` containing both variables, then `npm start` and open http://localhost:3000.

## Deploy to Vercel
1. Create a Supabase project (supabase.com), note the database password, then copy the Transaction pooler URI from **Connect**.
2. Push the repo to GitHub (make sure `.env` and `node_modules` are in `.gitignore`).
3. In Vercel: **Add New → Project**, import the repo, keep the preset on **Other**.
4. Add `TMDB_API_KEY` and `DATABASE_URL` as environment variables and deploy.
5. Register on the live site; the first account becomes the admin.

Tables are created automatically on the first request, with Row Level Security enabled so Supabase's public API cannot read them. Pick a Supabase region close to your Vercel function region.

## Layout
```
api/index.js   all API routes (Vercel function)
server.js      local dev server
public/        index.html, style.css, app.js
vercel.json    static output + /api rewrite
```
