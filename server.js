import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, SYNC_KEY } = env;
const BRANCH = env.GITHUB_BRANCH || "main";
const FILE = env.GITHUB_PATH || "data/phms.json";
const API = env.GITHUB_API_URL || "https://api.github.com";
const PORT = env.PORT || 3000;

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO || !SYNC_KEY || SYNC_KEY.length < 16) {
  console.error("Weka GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO na SYNC_KEY (angalau herufi 16).");
  process.exit(1);
}

const enc = encodeURIComponent;
const FILE_URL = `/repos/${enc(GITHUB_OWNER)}/${enc(GITHUB_REPO)}/contents/${FILE.split("/").map(enc).join("/")}`;
const gh = (p, o = {}) =>
  fetch(API + p, {
    ...o,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "phms-sync",
      "Content-Type": "application/json",
    },
  });

const sha256 = (s) => crypto.createHash("sha256").update(s).digest();
const KEYHASH = sha256(SYNC_KEY);
const auth = (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
  if (!m || !crypto.timingSafeEqual(sha256(m[1]), KEYHASH)) return res.status(401).json({ error: "unauthorized" });
  next();
};

const app = express();
if (env.TRUST_PROXY) app.set("trust proxy", Number(env.TRUST_PROXY) || 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
  next();
});
app.get("/health", (_, res) => res.json({ ok: true }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use("/api", express.json({ limit: "40mb" }));

// Soma data kutoka GitHub (inarudisha base64 + sha)
app.get("/api/data", auth, async (req, res) => {
  try {
    const r = await gh(`${FILE_URL}?ref=${enc(BRANCH)}`);
    if (r.status === 404) return res.json({ sha: null, content: null });
    if (!r.ok) return res.status(502).json({ error: "github " + r.status });
    const j = await r.json();
    let c = j.content;
    if (!c) {
      const g = await gh(new URL(j.git_url).pathname);
      if (!g.ok) return res.status(502).json({ error: "github blob " + g.status });
      c = (await g.json()).content;
    }
    res.set("Cache-Control", "no-store").json({ sha: j.sha, content: String(c).replace(/\s/g, "") });
  } catch {
    res.status(502).json({ error: "github haipatikani" });
  }
});

// Andika data kwenda GitHub
app.put("/api/data", auth, async (req, res) => {
  const { content, sha } = req.body || {};
  if (typeof content !== "string" || !/^[A-Za-z0-9+/=]+$/.test(content))
    return res.status(400).json({ error: "content (base64) inahitajika" });
  const body = { message: "PHMS sync " + new Date().toISOString(), content, branch: BRANCH };
  if (typeof sha === "string" && sha) body.sha = sha;
  try {
    const r = await gh(FILE_URL, { method: "PUT", body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) return res.status(409).json({ error: "conflict" });
    if (!r.ok) return res.status(502).json({ error: "github " + r.status });
    res.json({ sha: (await r.json()).content.sha });
  } catch {
    res.status(502).json({ error: "github haipatikani" });
  }
});

// Toa index.html pekee (si faili zingine kama .env au server.js)
const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");
app.get(["/", "/index.html"], (_, res) => res.sendFile(INDEX));
app.listen(PORT, () => console.log("PHMS sync server: http://localhost:" + PORT));
