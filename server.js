"use strict";
require("dotenv").config();
const express = require("express"), helmet = require("helmet"), rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs"), jwt = require("jsonwebtoken"), multer = require("multer");
const path = require("path"), fs = require("fs"), crypto = require("crypto");
const Store = require("./store");

const { PORT = 3000, JWT_SECRET, UPLOAD_DIR = "uploads", DATA_FILE = "data/db.json", FLUSH_MS = "3000",
  GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, GITHUB_API_URL } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32) { console.error("Set JWT_SECRET to 32+ random characters (see .env.example)."); process.exit(1); }
if (!!GITHUB_TOKEN !== !!GITHUB_REPO) { console.error("Set BOTH GITHUB_TOKEN and GITHUB_REPO (owner/name), or neither for local-file mode."); process.exit(1); }
const store = new Store({ token: GITHUB_TOKEN, repo: GITHUB_REPO, branch: GITHUB_BRANCH, apiUrl: GITHUB_API_URL, localFile: path.resolve(DATA_FILE), delay: Number(FLUSH_MS) });
const MAX_MB = Number(process.env.MAX_VIDEO_MB || (store.github ? 25 : 100));
const UP = path.resolve(UPLOAD_DIR); fs.mkdirSync(UP, { recursive: true });
let db;

/* ---------- demo content (seeded once into an empty database) ---------- */
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
function seed() {
  if (db.posts.length) return;
  SEED.forEach((s, i) => db.posts.push({ id: s[0], uid: null, username: s[1], emoji: s[2], a: s[3], b: s[4], cap: s[5], m: s[6], c: s[7], base: s[8], video: null, created: Date.now() - (i + 1) * 3600e3 }));
  store.touch();
}

/* ---------- helpers ---------- */
const USER_RE = /^[a-z0-9._]{3,20}$/, EMAIL_RE = /^\S+@\S+\.\S+$/;
const EXT = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };
const FILE_RE = /^[0-9a-f-]{36}\.(mp4|webm|mov)$/;
const base = m => String(m || "").split(";")[0].trim().toLowerCase();
const ah = f => (req, res, next) => f(req, res, next).catch(next);
const bad = (res, error, code = 400) => res.status(code).json({ error });
const session = u => ({ token: jwt.sign({ uid: u.id, u: u.username }, JWT_SECRET, { algorithm: "HS256", expiresIn: "30d" }), user: { username: u.username } });
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);
const byName = n => db.users.find(u => u.username === n), byId = id => db.users.find(u => u.id === id);
const postById = id => db.posts.find(p => p.id === id);
// blue tick: automatic once an account has VERIFY_AT followers (default 1000)
const VERIFY_AT = Number(process.env.VERIFY_AT || 1000);
const followerCounts = () => { const m = new Map(); for (const a of Object.values(db.follows)) for (const t of a) m.set(t, (m.get(t) || 0) + 1); return m; };

function parseToken(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  try { return jwt.verify(m[1], JWT_SECRET, { algorithms: ["HS256"] }); } catch { return null; }
}
const optAuth = (req, res, next) => { const t = parseToken(req); if (t && byId(t.uid)) { req.uid = t.uid; req.uname = byId(t.uid).username; } next(); };
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

app.get("/api/health", (req, res) => res.json({ ok: true, storage: store.github ? "github" : "local-file" }));

/* ----- auth ----- */
app.post("/api/auth/register", authLimiter, ah(async (req, res) => {
  const u = String(req.body.username || "").trim().toLowerCase(), e = String(req.body.email || "").trim().toLowerCase(), p = String(req.body.password || "");
  if (!USER_RE.test(u)) return bad(res, "Username: 3–20 letters, numbers, dots or underscores.");
  if (!EMAIL_RE.test(e) || e.length > 254) return bad(res, "Enter a valid email address.");
  if (p.length < 6 || p.length > 72) return bad(res, "Password must be 6–72 characters.");
  if (RESERVED.has(u)) return bad(res, "That username is not available.", 409);
  const hash = await bcrypt.hash(p, 12);
  if (byName(u)) return bad(res, "That username is already taken.", 409); // checked after the await, then written synchronously
  if (db.users.some(x => x.email === e)) return bad(res, "That email is already registered.", 409);
  const user = { id: db.nextUser++, username: u, email: e, hash, created: Date.now() };
  db.users.push(user); store.touch();
  res.status(201).json(session(user));
}));
app.post("/api/auth/login", authLimiter, ah(async (req, res) => {
  const id = String(req.body.username || "").trim().toLowerCase(), p = String(req.body.password || "");
  const u = byName(id) || (id.includes("@") ? db.users.find(x => x.email === id) : null);
  const ok = await bcrypt.compare(p, u ? u.hash : DUMMY_HASH);
  if (!u || !ok) return bad(res, "Incorrect username or password.", 401);
  res.json(session(u));
}));
app.get("/api/me", auth, (req, res) => res.json({ username: req.uname }));
app.get("/api/state", auth, (req, res) => {
  const likes = {}; for (const [pid, arr] of Object.entries(db.likes)) if (arr.includes(req.uid)) likes[pid] = 1;
  const follows = Object.fromEntries((db.follows[req.uid] || []).map(t => [t, 1]));
  const followers = followerCounts().get(req.uname) || 0;
  const likesReceived = db.posts.filter(p => p.uid === req.uid).reduce((n, p) => n + (db.likes[p.id] || []).length, 0);
  res.json({ likes, follows, followers, likesReceived, maxVideoMb: MAX_MB, verified: followers >= VERIFY_AT, verifyAt: VERIFY_AT });
});

/* ----- feed, likes, follows ----- */
app.get("/api/feed", optAuth, (req, res) => {
  const fc = followerCounts(), cc = new Map(); for (const c of db.comments) cc.set(c.post, (cc.get(c.post) || 0) + 1);
  res.json([...db.posts].sort((a, b) => b.created - a.created).slice(0, 100).map(p => ({
    id: p.id, u: p.username, v: (fc.get(p.username) || 0) >= VERIFY_AT, e: p.emoji, a: p.a, b: p.b, cap: p.cap, m: p.m, c: p.c, src: p.video,
    l: p.base + (db.likes[p.id] || []).filter(x => x !== req.uid).length, cc: cc.get(p.id) || 0 })));
});
app.put("/api/posts/:id/like", auth, writeLimiter, (req, res) => {
  if (!postById(req.params.id)) return bad(res, "Video not found.", 404);
  const arr = db.likes[req.params.id] || (db.likes[req.params.id] = []), has = arr.includes(req.uid);
  if (req.body.on && !has) arr.push(req.uid); else if (!req.body.on && has) db.likes[req.params.id] = arr.filter(x => x !== req.uid);
  store.touch(); res.json({ ok: true });
});
app.put("/api/follows/:target", auth, writeLimiter, (req, res) => {
  const t = req.params.target.toLowerCase();
  if (!/^[a-z0-9._]{1,20}$/.test(t) || t === req.uname) return bad(res, "Invalid user.");
  const arr = db.follows[req.uid] || (db.follows[req.uid] = []), has = arr.includes(t);
  if (req.body.on && !has) arr.push(t); else if (!req.body.on && has) db.follows[req.uid] = arr.filter(x => x !== t);
  store.touch(); res.json({ ok: true });
});

/* ----- comments (threaded one level) ----- */
const pub = (c, fc) => ({ id: c.id, username: c.username, v: (fc.get(c.username) || 0) >= VERIFY_AT, parent_id: c.parent, body: c.body, created_at: new Date(c.created).toISOString() });
app.get("/api/posts/:id/comments", auth, (req, res) => {
  const fc = followerCounts();
  res.json(db.comments.filter(c => c.post === req.params.id).sort((a, b) => a.created - b.created).slice(0, 300).map(c => pub(c, fc)));
});
app.post("/api/posts/:id/comments", auth, writeLimiter, (req, res) => {
  const body = String(req.body.text || "").trim();
  if (!body || body.length > 200) return bad(res, "Comment must be 1–200 characters.");
  if (!postById(req.params.id)) return bad(res, "Video not found.", 404);
  let parent = Number.isInteger(req.body.parent) ? req.body.parent : null;
  if (parent) {
    const p = db.comments.find(c => c.id === parent && c.post === req.params.id);
    if (!p) return bad(res, "Comment not found.", 404);
    parent = p.parent || p.id;
  }
  const c = { id: db.nextComment++, post: req.params.id, uid: req.uid, username: req.uname, parent, body, created: Date.now() };
  db.comments.push(c); store.touch(); res.status(201).json(pub(c, followerCounts()));
});

/* ----- video upload (saved on disk, then committed to the GitHub repo) ----- */
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (req, f, cb) => cb(null, crypto.randomUUID() + EXT[base(f.mimetype)]) }),
  limits: { fileSize: MAX_MB * 1048576, files: 1, fields: 5 },
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
  const drop = () => fs.unlink(req.file.path, () => {});
  if (!looksLikeVideo(req.file.path)) { drop(); return bad(res, "That file is not a valid video."); }
  if (store.github) {
    try { await store.saveVideo(req.file.filename, fs.readFileSync(req.file.path)); }
    catch (e) { console.error(e.message); drop(); return bad(res, "Could not save the video. Please try again.", 502); }
  }
  const g = GRADS[Math.floor(Math.random() * GRADS.length)], id = "v" + crypto.randomBytes(6).toString("hex");
  db.posts.push({ id, uid: req.uid, username: req.uname, emoji: "🎬", a: g[0], b: g[1], cap: String(req.body.caption || "").trim().slice(0, 300),
    m: `Original sound – @${req.uname}`, c: String(req.body.category || "All").slice(0, 20), base: 0, video: "/uploads/" + req.file.filename, created: Date.now() });
  store.touch(); res.status(201).json({ id });
}));
app.delete("/api/posts/:id", auth, (req, res) => {
  const p = postById(req.params.id);
  if (!p || p.uid !== req.uid) return bad(res, "Not found.", 404);
  db.posts = db.posts.filter(x => x !== p); delete db.likes[p.id]; db.comments = db.comments.filter(c => c.post !== p.id); store.touch();
  if (p.video) { const n = path.basename(p.video); fs.unlink(path.join(UP, n), () => {}); if (store.github) store.removeVideo(n).catch(e => console.error(e.message)); }
  res.json({ ok: true });
});

/* ----- videos: local cache first, otherwise pulled back from the GitHub repo ----- */
app.get("/uploads/:name", ah(async (req, res) => {
  const n = req.params.name;
  if (!FILE_RE.test(n)) return res.status(404).end();
  const f = path.join(UP, n);
  if (!fs.existsSync(f)) {
    const buf = store.github ? await store.fetchVideo(n) : null;
    if (!buf) return res.status(404).end();
    const tmp = f + "." + process.pid + "." + Date.now() + ".tmp"; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(f, { maxAge: "7d", immutable: true });
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (req, res) => bad(res, "Not found.", 404));

app.use((err, req, res, next) => { // eslint-disable-line
  if (err instanceof multer.MulterError) return bad(res, err.code === "LIMIT_FILE_SIZE" ? `Video too large (max ${MAX_MB} MB).` : "Upload failed.");
  if (err.status && err.status < 500) return bad(res, err.message, err.status);
  console.error(err); bad(res, "Server error. Please try again.", 500);
});

store.load().then(d => { db = d; seed(); }).then(() => {
  const srv = app.listen(PORT, () => console.log(`CODESTER running on port ${PORT} (storage: ${store.github ? "GitHub repo " + GITHUB_REPO : "local file " + DATA_FILE})`));
  const stop = async () => { srv.close(); await store.close(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}).catch(e => { console.error("Startup failed: " + e.message + (store.github ? "\nCheck GITHUB_TOKEN (needs Contents: read & write), GITHUB_REPO and that the repo and branch exist." : "")); process.exit(1); });
