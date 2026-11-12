"use strict";
require("dotenv").config();
const express = require("express"), helmet = require("helmet"), rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs"), jwt = require("jsonwebtoken"), multer = require("multer"), { Pool } = require("pg");
const path = require("path"), fs = require("fs"), crypto = require("crypto");

const { PORT = 3000, DATABASE_URL, JWT_SECRET, UPLOAD_DIR = "uploads", MAX_VIDEO_MB = "100" } = process.env;
if (!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set DATABASE_URL and a JWT_SECRET of at least 32 characters (see .env.example).");
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
const q = (text, params) => pool.query(text, params);
const UP = path.resolve(UPLOAD_DIR); fs.mkdirSync(UP, { recursive: true });

/* ---------- demo content (seeded once) ---------- */
const SEED = [
  ["p1","neon.nomad","🌃","#0f2027","#2c5364","Midnight drive through the city lights. Turn the volume up and let the neon do the talking. #nightdrive #citylights #vibes","Neon Nights – Synthwave Loop","Travel",128400],
  ["p2","chef.amani","🍛","#f12711","#f5af19","Pilau in 10 minutes? Yes, it works. Save this for Sunday! #recipe #pilau #foodtok","Kitchen Beats – Amani Mix","Food",56200],
  ["p3","zuri.dance","💃","#8e2de2","#fe0979","New choreography dropped. Tag a friend who needs to learn this one. #dance #bongoflava #challenge","Bongo Heat – Zuri Remix","Dance",402900],
  ["p4","mlima.hike","🏔️","#134e5e","#71b280","Sunrise above the clouds after a 5 hour climb. Worth every step. #hiking #kilimanjaro #nature","Summit – Ambient Peaks","Travel",88100],
  ["p5","dev.frex","💻","#00c6ff","#0072ff","Shipped a full app in a single HTML file. No build step, no stress. #coding #webdev #buildinpublic","Lo-fi Compile – Code Beats","Tech",23700],
  ["p6","paka.pets","🐱","#ff9a9e","#fad0c4","He thinks he is a lion. He is not. #cats #funny #pets","Meow Remix – Tiny Lion","Pets",731500],
  ["p7","fit.neema","🏋️","#232526","#fe0979","15 minute home workout, zero equipment. Do it with me. #fitness #workout #motivation","Pump Up – Rhythm Lab","Fitness",41900],
  ["p8","gari.shots","🚗","#42275a","#734b6d","Restoring a 1989 Land Cruiser, part 4: the engine finally starts. #cars #restoration #diy","Engine Roar – Garage Radio","Cars",67300],
];
const RESERVED = new Set([...SEED.map(s => s[1]), "admin", "codester", "support", "root", "moderator"]);

async function migrate() {
  await q(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  for (let i = 0; i < SEED.length; i++) {
    const s = SEED[i];
    await q(`INSERT INTO posts(id,username,emoji,color_a,color_b,caption,music,category,likes_base,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - make_interval(hours => $10)) ON CONFLICT DO NOTHING`, [...s, i + 1]);
  }
}

/* ---------- helpers ---------- */
const USER_RE = /^[a-z0-9._]{3,20}$/, EMAIL_RE = /^\S+@\S+\.\S+$/;
const EXT = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };
const base = m => String(m || "").split(";")[0].trim().toLowerCase();
const ah = f => (req, res, next) => f(req, res, next).catch(next);
const bad = (res, error, code = 400) => res.status(code).json({ error });
const session = u => ({ token: jwt.sign({ uid: u.id, u: u.username }, JWT_SECRET, { algorithm: "HS256", expiresIn: "30d" }), user: { username: u.username } });
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);

function parseToken(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  try { return jwt.verify(m[1], JWT_SECRET, { algorithms: ["HS256"] }); } catch { return null; }
}
const optAuth = (req, res, next) => { const t = parseToken(req); if (t) { req.uid = t.uid; req.uname = t.u; } next(); };
const auth = (req, res, next) => optAuth(req, res, () => req.uid ? next() : bad(res, "Please log in.", 401));

/* ---------- app ---------- */
const app = express();
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"], mediaSrc: ["'self'", "blob:"], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'self'"],
  } },
  crossOriginResourcePolicy: { policy: "same-origin" },
}));
app.use(express.json({ limit: "20kb" }));
const limiter = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please slow down." } });
app.use("/api", limiter(60e3, 300));
const authLimiter = limiter(15 * 60e3, 30), writeLimiter = limiter(60e3, 30), uploadLimiter = limiter(60 * 60e3, 20);

app.get("/api/health", ah(async (req, res) => { await q("SELECT 1"); res.json({ ok: true }); }));

/* ----- auth ----- */
app.post("/api/auth/register", authLimiter, ah(async (req, res) => {
  const u = String(req.body.username || "").trim().toLowerCase(), e = String(req.body.email || "").trim().toLowerCase(), p = String(req.body.password || "");
  if (!USER_RE.test(u)) return bad(res, "Username: 3–20 letters, numbers, dots or underscores.");
  if (!EMAIL_RE.test(e) || e.length > 254) return bad(res, "Enter a valid email address.");
  if (p.length < 6 || p.length > 72) return bad(res, "Password must be 6–72 characters.");
  if (RESERVED.has(u)) return bad(res, "That username is not available.", 409);
  const hash = await bcrypt.hash(p, 12);
  try {
    const { rows } = await q("INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username", [u, e, hash]);
    res.status(201).json(session(rows[0]));
  } catch (err) {
    if (err.code === "23505") return bad(res, /email/.test(err.constraint || "") ? "That email is already registered." : "That username is already taken.", 409);
    throw err;
  }
}));
app.post("/api/auth/login", authLimiter, ah(async (req, res) => {
  const u = String(req.body.username || "").trim().toLowerCase(), p = String(req.body.password || "");
  const { rows } = await q("SELECT id,username,password_hash FROM users WHERE username=$1", [u]);
  const ok = await bcrypt.compare(p, rows[0] ? rows[0].password_hash : DUMMY_HASH);
  if (!rows[0] || !ok) return bad(res, "Incorrect username or password.", 401);
  res.json(session(rows[0]));
}));
app.get("/api/me", auth, ah(async (req, res) => {
  const { rows } = await q("SELECT username FROM users WHERE id=$1", [req.uid]);
  if (!rows[0]) return bad(res, "Please log in.", 401);
  res.json(rows[0]);
}));
app.get("/api/state", auth, ah(async (req, res) => {
  const me = await q("SELECT 1 FROM users WHERE id=$1", [req.uid]);
  if (!me.rowCount) return bad(res, "Please log in.", 401);
  const [l, f, fo, lr] = await Promise.all([
    q("SELECT post_id FROM likes WHERE user_id=$1", [req.uid]),
    q("SELECT target FROM follows WHERE user_id=$1", [req.uid]),
    q("SELECT count(*)::int AS n FROM follows WHERE target=$1", [req.uname]),
    q("SELECT count(*)::int AS n FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=$1", [req.uid]),
  ]);
  res.json({ likes: Object.fromEntries(l.rows.map(r => [r.post_id, 1])), follows: Object.fromEntries(f.rows.map(r => [r.target, 1])), followers: fo.rows[0].n, likesReceived: lr.rows[0].n });
}));

/* ----- feed, likes, follows ----- */
app.get("/api/feed", optAuth, ah(async (req, res) => {
  const { rows } = await q(`
    SELECT p.*, p.likes_base + (SELECT count(*) FROM likes l WHERE l.post_id=p.id AND l.user_id IS DISTINCT FROM $1::int) AS l,
           (SELECT count(*) FROM comments c WHERE c.post_id=p.id) AS cc
    FROM posts p ORDER BY p.created_at DESC LIMIT 100`, [req.uid || null]);
  res.json(rows.map(r => ({ id: r.id, u: r.username, e: r.emoji, a: r.color_a, b: r.color_b, cap: r.caption, m: r.music, c: r.category, l: +r.l, cc: +r.cc, src: r.video_url })));
}));
app.put("/api/posts/:id/like", auth, writeLimiter, ah(async (req, res) => {
  if (req.body.on) await q("INSERT INTO likes(user_id,post_id) SELECT $1,id FROM posts WHERE id=$2 ON CONFLICT DO NOTHING", [req.uid, req.params.id]);
  else await q("DELETE FROM likes WHERE user_id=$1 AND post_id=$2", [req.uid, req.params.id]);
  res.json({ ok: true });
}));
app.put("/api/follows/:target", auth, writeLimiter, ah(async (req, res) => {
  const t = req.params.target.toLowerCase();
  if (!/^[a-z0-9._]{1,20}$/.test(t) || t === req.uname) return bad(res, "Invalid user.");
  if (req.body.on) await q("INSERT INTO follows(user_id,target) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.uid, t]);
  else await q("DELETE FROM follows WHERE user_id=$1 AND target=$2", [req.uid, t]);
  res.json({ ok: true });
}));

/* ----- comments (threaded one level) ----- */
app.get("/api/posts/:id/comments", auth, ah(async (req, res) => {
  const { rows } = await q("SELECT id,username,parent_id,body,created_at FROM comments WHERE post_id=$1 ORDER BY created_at ASC LIMIT 300", [req.params.id]);
  res.json(rows);
}));
app.post("/api/posts/:id/comments", auth, writeLimiter, ah(async (req, res) => {
  const body = String(req.body.text || "").trim();
  if (!body || body.length > 200) return bad(res, "Comment must be 1–200 characters.");
  let parent = Number.isInteger(req.body.parent) ? req.body.parent : null;
  if (parent) {
    const p = await q("SELECT id,parent_id FROM comments WHERE id=$1 AND post_id=$2", [parent, req.params.id]);
    if (!p.rowCount) return bad(res, "Comment not found.", 404);
    parent = p.rows[0].parent_id || p.rows[0].id;
  }
  const { rows } = await q(`INSERT INTO comments(post_id,user_id,username,parent_id,body)
    SELECT id,$2,$3,$4,$5 FROM posts WHERE id=$1 RETURNING id,username,parent_id,body,created_at`, [req.params.id, req.uid, req.uname, parent, body]);
  if (!rows[0]) return bad(res, "Video not found.", 404);
  res.status(201).json(rows[0]);
}));

/* ----- video upload ----- */
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (req, f, cb) => cb(null, crypto.randomUUID() + EXT[base(f.mimetype)]) }),
  limits: { fileSize: Number(MAX_VIDEO_MB) * 1048576, files: 1, fields: 5 },
  fileFilter: (req, f, cb) => EXT[base(f.mimetype)] ? cb(null, true) : cb(Object.assign(new Error("Only MP4, WebM or MOV videos are allowed."), { status: 400 })),
});
function looksLikeVideo(file) { // check magic bytes, not just the client's claimed type
  const b = Buffer.alloc(12), fd = fs.openSync(file, "r");
  try { fs.readSync(fd, b, 0, 12, 0); } finally { fs.closeSync(fd); }
  return b.slice(4, 8).toString() === "ftyp" || (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3);
}
const GRADS = [["#0f2027", "#2c5364"], ["#8e2de2", "#fe0979"], ["#00c6ff", "#0072ff"], ["#f12711", "#f5af19"], ["#134e5e", "#71b280"]];
app.post("/api/videos", auth, uploadLimiter, upload.single("video"), ah(async (req, res) => {
  if (!req.file) return bad(res, "Choose a video to upload.");
  if (!looksLikeVideo(req.file.path)) { fs.unlink(req.file.path, () => {}); return bad(res, "That file is not a valid video."); }
  const caption = String(req.body.caption || "").trim().slice(0, 300), cat = String(req.body.category || "All").slice(0, 20);
  const g = GRADS[Math.floor(Math.random() * GRADS.length)], id = "v" + crypto.randomBytes(6).toString("hex");
  await q(`INSERT INTO posts(id,user_id,username,emoji,color_a,color_b,caption,music,category,video_url)
           VALUES($1,$2,$3,'🎬',$4,$5,$6,$7,$8,$9)`, [id, req.uid, req.uname, g[0], g[1], caption, `Original sound – @${req.uname}`, cat, "/uploads/" + req.file.filename]);
  res.status(201).json({ id });
}));
app.delete("/api/posts/:id", auth, ah(async (req, res) => {
  const { rows } = await q("DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING video_url", [req.params.id, req.uid]);
  if (!rows[0]) return bad(res, "Not found.", 404);
  if (rows[0].video_url) fs.unlink(path.join(UP, path.basename(rows[0].video_url)), () => {});
  res.json({ ok: true });
}));

/* ----- static ----- */
app.use("/uploads", express.static(UP, { maxAge: "7d", immutable: true, setHeaders: r => r.setHeader("X-Content-Type-Options", "nosniff") }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (req, res) => bad(res, "Not found.", 404));

app.use((err, req, res, next) => { // eslint-disable-line
  if (err instanceof multer.MulterError) return bad(res, err.code === "LIMIT_FILE_SIZE" ? `Video too large (max ${MAX_VIDEO_MB} MB).` : "Upload failed.");
  if (err.status && err.status < 500) return bad(res, err.message, err.status);
  console.error(err); bad(res, "Server error. Please try again.", 500);
});

migrate().then(() => app.listen(PORT, () => console.log(`CODESTER running on port ${PORT}`)))
  .catch(e => { console.error("Startup failed:", e.message); process.exit(1); });
