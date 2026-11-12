# CODESTER

Short-video social app. Node/Express server, **GitHub repository as the database**, mobile web app served from `public/`.

- Anyone can register and log in (bcrypt-hashed passwords, 30-day JWT)
- Users, videos, likes, follows and threaded comments are saved in your private GitHub repo
- Real video upload (camera recording or file) with a progress bar; videos are committed to the same repo
- One origin for page and API, so there is no CORS setup and the GitHub token never reaches the browser

## 1. Create the GitHub database (5 minutes)

1. On GitHub create a **private** repository, for example `yourname/codester-data`. Tick "Add a README" so the repo has a first commit.
   It must be private: it will hold password hashes and email addresses.
2. Go to Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate new token.
   Repository access: **Only select repositories** and pick `codester-data`. Permissions: **Contents = Read and write**. Copy the token.

## 2. Run it

```bash
npm install
cp .env.example .env     # fill in JWT_SECRET, GITHUB_REPO=yourname/codester-data, GITHUB_TOKEN=...
npm start                # open http://localhost:3000
npm test                 # optional: full end-to-end test using a fake GitHub
```

Leave both `GITHUB_*` values empty to run in local-file mode (data in `data/db.json`) while developing.
Generate the secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## 3. Put it online

GitHub Pages cannot run this (it only hosts static files, and a token in a web page would be public). Use any free or cheap Node host:

- **Render / Railway / Koyeb / Fly.io:** new Web Service from this folder (or the Dockerfile), start command `npm start`, add the env vars from `.env.example`. A disk is **not** required because every video is also stored in GitHub and is restored on demand.
- **VPS:** Node 18+, run with `pm2`, Nginx in front for HTTPS, `client_max_body_size 30m;`.

The camera only works over HTTPS (localhost is fine for testing).

## Accounts and the blue tick

- Sign up creates the account and logs the user in straight away. Later they can log in with **username or email** plus password.
- An account gets the **blue tick automatically at 1,000 followers** (people who follow them). It shows next to their name on videos, in comments and on their profile, and disappears if they drop below the number. Change the number with `VERIFY_AT` in `.env`.
- Profile screen shows progress, for example "340 / 1K followers to get the blue tick".

## How the GitHub database behaves

- All data lives in memory for speed and is saved to `data/db.json` in the repo about 3 seconds after any change, and again on shutdown. Each save is a commit.
- Videos are saved to `videos/` in the repo before the upload is confirmed to the user. Default limit is 25 MB per video (set `MAX_VIDEO_MB` to change).
- If GitHub is unreachable, the app keeps working and retries the save every 10 seconds.
- Run **one** server instance only. Two instances would overwrite each other's saves.
- GitHub allows 5,000 API requests per hour per token and recommends repositories under 1 GB. Roughly 40 videos of 25 MB fill 1 GB. This design is right for a launch, a pilot or a community of hundreds. When videos or traffic grow, move videos to S3 or Cloudflare R2 and the data to PostgreSQL (only `store.js` and the upload route change).

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

bcrypt (cost 12), JWT with a fixed algorithm, rate limits on login, writes and uploads, helmet security headers and CSP, upload type allow-list plus file-signature check, size limit, random server-generated file names, path-traversal protection, comments escaped on render. A corrupt data file stops startup instead of being overwritten.

## Before a public launch

Email verification and password reset, a report button with admin moderation, a terms and privacy page, and a backup habit (the repo history already keeps every version of the data).
