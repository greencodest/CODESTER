# CODESTER

Short-video social app. Node/Express + PostgreSQL backend; the mobile web app is served from `public/`.

- Anyone can register and log in (bcrypt-hashed passwords, 30-day JWT)
- Real database: users, videos, likes, follows and threaded comments
- Real video upload (camera recording or file) with progress bar, served with range requests
- Everything runs on one origin, so there is no CORS setup

## Run locally

```bash
npm install
createdb codester                       # or any PostgreSQL 13+ database
cp .env.example .env                    # set DATABASE_URL and JWT_SECRET
npm start                               # tables are created automatically on boot
```

Open http://localhost:3000 and sign up. The camera needs HTTPS in production (localhost is fine for testing).

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Deploy (pick one)

**Render / Railway / Fly.io:** create a PostgreSQL instance, create a Web Service from this folder (or the Dockerfile), set the env vars from `.env.example` (`DATABASE_SSL=true` for most managed databases) and attach a **persistent disk** mounted at the `UPLOAD_DIR` path. Without a disk, uploaded videos are lost on redeploy.

**VPS (Ubuntu):** install Node 20 and PostgreSQL, run the app with `pm2` or systemd, put Nginx in front for HTTPS (Let's Encrypt) and set `client_max_body_size 110m;` so uploads up to `MAX_VIDEO_MB` get through.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/auth/register | no | `{username,email,password}` |
| POST | /api/auth/login | no | `{username,password}` |
| GET | /api/me, /api/state | yes | current user, likes, follows, counts |
| GET | /api/feed | optional | latest 100 videos with like and comment counts |
| PUT | /api/posts/:id/like | yes | `{on:true/false}` |
| PUT | /api/follows/:username | yes | `{on:true/false}` |
| GET/POST | /api/posts/:id/comments | yes | list / add (`{text,parent?}`) |
| POST | /api/videos | yes | multipart: `video`, `caption`, `category` |
| DELETE | /api/posts/:id | yes | delete your own video |

## Security built in

bcrypt (cost 12), JWT with fixed algorithm, rate limits on login, writes and uploads, parameterised SQL only, helmet security headers and CSP, upload type allow-list plus file-signature check, size limit, random server-generated file names, comments escaped on render.

## Before real launch

- Move videos to object storage (S3, Cloudflare R2) with a CDN once you have many users; keep the `video_url` column, only the upload and serve code changes.
- Add email verification and password reset (needs an email provider).
- Add moderation: report button, admin delete, and a terms/privacy page.
- Take regular PostgreSQL backups (`pg_dump`) and back up the uploads folder.
