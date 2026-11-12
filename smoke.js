"use strict";
// End-to-end test: server + fake GitHub. Proves data and videos survive a restart with an empty disk.
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const { start } = require("./mock-github");
const GH = 3201, APP = 3200, B = `http://localhost:${APP}/api`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codester-")), ups = path.join(tmp, "ups");
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = (t, extra = {}) => ({ "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}), ...extra });
const call = async (m, p, t, body) => { const r = await fetch(B + p, { method: m, headers: J(t), body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
async function boot() {
  const p = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, PORT: APP, JWT_SECRET: "x".repeat(40), UPLOAD_DIR: ups,
    GITHUB_TOKEN: "test-token", GITHUB_REPO: "me/codester-data", GITHUB_API_URL: `http://localhost:${GH}`, FLUSH_MS: "150", VERIFY_AT: "2", DATA_FILE: path.join(tmp, "unused.json") } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + "/health")).ok) return p; } catch {} await sleep(200); }
  throw new Error("server did not start");
}
const stop = p => new Promise(r => { p.on("exit", r); p.kill("SIGTERM"); });
(async () => {
  const gh = await start(GH); let app = await boot();
  const reg = await call("POST", "/auth/register", null, { username: "frex_t", email: "t@x.co", password: "secret1" });
  ok(reg.s === 201 && reg.j.token, "register"); const T = reg.j.token;
  ok((await call("POST", "/auth/register", null, { username: "frex_t", email: "o@x.co", password: "secret1" })).s === 409, "duplicate username rejected");
  ok((await call("POST", "/auth/register", null, { username: "admin", email: "a@x.co", password: "secret1" })).s === 409, "reserved username rejected");
  ok((await call("POST", "/auth/login", null, { username: "frex_t", password: "bad" })).s === 401, "wrong password rejected");
  ok((await call("GET", "/state")).s === 401, "state needs login");
  await call("PUT", "/posts/p3/like", T, { on: true }); await call("PUT", "/follows/zuri.dance", T, { on: true });
  const c1 = await call("POST", "/posts/p3/comments", T, { text: "first <b>!</b>" });
  await call("POST", "/posts/p3/comments", T, { text: "reply", parent: c1.j.id });
  ok((await call("POST", "/posts/nope/comments", T, { text: "x" })).s === 404, "comment on missing video rejected");
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(4000, 7)]);
  const up = async (buf, type) => { const fd = new FormData(); fd.append("caption", "my #video"); fd.append("category", "Tech"); fd.append("video", new Blob([buf], { type }), "a.mp4");
    const r = await fetch(B + "/videos", { method: "POST", headers: { authorization: "Bearer " + T }, body: fd }); return { s: r.status, j: await r.json() }; };
  ok((await up(Buffer.from("not a video"), "video/mp4")).s === 400, "fake video rejected");
  ok((await up(mp4, "text/html")).s === 400, "wrong type rejected");
  const v = await up(mp4, "video/webm;codecs=vp8"); ok(v.s === 201, "video upload (codec-suffixed type) accepted");
  await sleep(600);
  ok(gh.files.has("data/db.json"), "database file committed to GitHub repo");
  ok([...gh.files.keys()].some(k => /^videos\/.+\.mp4$|^videos\/.+\.webm$/.test(k)), "video committed to GitHub repo");
  const feed1 = await call("GET", "/feed", T); const mine = feed1.j.find(x => x.u === "frex_t");
  await stop(app); fs.rmSync(ups, { recursive: true, force: true }); // simulate a host that wipes its disk
  app = await boot();
  const login = await call("POST", "/auth/login", null, { username: "frex_t", password: "secret1" }); ok(login.s === 200, "login works after restart (account loaded from GitHub)");
  const st = await call("GET", "/state", login.j.token); ok(st.j.likes.p3 === 1 && st.j.follows["zuri.dance"] === 1, "likes and follows survived restart");
  const cm = await call("GET", "/posts/p3/comments", login.j.token); ok(cm.j.length === 2 && cm.j[1].parent_id === cm.j[0].id, "threaded comments survived restart");
  const feed2 = await call("GET", "/feed", login.j.token); ok(feed2.j.some(x => x.src === mine.src), "uploaded video still in feed");
  const r1 = await fetch(`http://localhost:${APP}${mine.src}`); ok(r1.status === 200 && Buffer.from(await r1.arrayBuffer()).equals(mp4), "video restored from GitHub with identical bytes");
  const r2 = await fetch(`http://localhost:${APP}${mine.src}`, { headers: { range: "bytes=0-99" } }); ok(r2.status === 206, "range request (seeking) works");
  const em = await call("POST", "/auth/login", null, { username: "T@X.co", password: "secret1" }); ok(em.s === 200, "login with email works");
  const mk = async n => (await call("POST", "/auth/register", null, { username: n, email: n + "@x.co", password: "secret1" })).j.token;
  const tb = await mk("fan_b"), tc = await mk("fan_c"), LT = login.j.token;
  let sT = await call("GET", "/state", LT); ok(sT.j.verified === false && sT.j.verifyAt === 2, "no blue tick before the threshold");
  await call("PUT", "/follows/frex_t", tb, { on: true });
  ok((await call("GET", "/state", LT)).j.verified === false, "1 follower: still no blue tick");
  await call("PUT", "/follows/frex_t", tc, { on: true });
  sT = await call("GET", "/state", LT); ok(sT.j.followers === 2 && sT.j.verified === true, "blue tick once the follower threshold is reached");
  ok((await call("GET", "/feed", LT)).j.find(x => x.id === mine.id).v === true, "blue tick shown on the creator's videos");
  ok((await call("GET", "/posts/p3/comments", LT)).j[0].v === true, "blue tick shown on the creator's comments");
  ok((await call("GET", "/feed", LT)).j.find(x => x.u === "zuri.dance").v === false, "other creators without followers have no tick");
  await call("PUT", "/follows/frex_t", tc, { on: false });
  ok((await call("GET", "/state", LT)).j.verified === false, "tick disappears if followers drop below the threshold");
  ok((await fetch(`http://localhost:${APP}/uploads/..%2F..%2Fserver.js`)).status === 404, "path traversal blocked");
  ok((await call("DELETE", "/posts/" + mine.id, login.j.token)).s === 200, "delete own video");
  await sleep(500); ok(![...gh.files.keys()].some(k => k.startsWith("videos/")), "video removed from GitHub repo");
  await stop(app); gh.srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FAILED` : "\nALL TESTS PASSED"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
