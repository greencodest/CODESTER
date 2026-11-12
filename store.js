"use strict";
// Data layer: the whole database is one JSON document held in memory and saved to a PRIVATE GitHub repo
// (data/db.json) through the GitHub Contents API. Videos are stored in the same repo under videos/.
// With no GitHub settings it falls back to a local JSON file (development only).
const fs = require("fs"), path = require("path");
const EMPTY = () => ({ v: 1, nextUser: 1, nextComment: 1, users: [], posts: [], likes: {}, follows: {}, comments: [] });

class Store {
  constructor(o) {
    Object.assign(this, { token: o.token, repo: o.repo, branch: o.branch || "main", apiUrl: (o.apiUrl || "https://api.github.com").replace(/\/$/, ""),
      localFile: o.localFile, delay: o.delay ?? 3000, dataFile: "data/db.json", sha: undefined, dirty: false, timer: null, chain: Promise.resolve() });
    this.db = EMPTY();
  }
  get github() { return !!(this.token && this.repo); }

  async gh(method, url, { body, raw } = {}) {
    return fetch(this.apiUrl + url, { method, body: body ? JSON.stringify(body) : undefined, headers: {
      Authorization: "Bearer " + this.token, "User-Agent": "codester", "X-GitHub-Api-Version": "2022-11-28",
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", ...(body ? { "Content-Type": "application/json" } : {}) } });
  }
  async fail(r, what) { throw new Error(`GitHub ${what} failed (${r.status}): ${(await r.text()).slice(0, 160)}`); }
  async list(dir) {
    const r = await this.gh("GET", `/repos/${this.repo}/contents/${dir}?ref=${encodeURIComponent(this.branch)}`);
    if (r.status === 404) return [];
    if (!r.ok) await this.fail(r, "list " + dir);
    const j = await r.json(); return Array.isArray(j) ? j : [];
  }
  async sha1(file) { const e = (await this.list(path.posix.dirname(file))).find(x => x.name === path.posix.basename(file)); return e && e.sha; }
  async put(file, buf, message) {
    const body = { message, content: Buffer.from(buf).toString("base64"), branch: this.branch };
    for (let i = 0; i < 3; i++) {
      if (file === this.dataFile && this.sha) body.sha = this.sha;
      const r = await this.gh("PUT", `/repos/${this.repo}/contents/${file}`, { body });
      if (r.ok) { const j = await r.json(); if (file === this.dataFile) this.sha = j.content.sha; return; }
      if (r.status === 409 || r.status === 422) { const s = await this.sha1(file); if (s) body.sha = s; else delete body.sha; if (file === this.dataFile) this.sha = s; continue; }
      await this.fail(r, "save " + file);
    }
    throw new Error("GitHub save failed: repeated conflict on " + file);
  }
  async getRaw(file) {
    const r = await this.gh("GET", `/repos/${this.repo}/contents/${file}?ref=${encodeURIComponent(this.branch)}`, { raw: true });
    if (r.status === 404) return null;
    if (!r.ok) await this.fail(r, "read " + file);
    return Buffer.from(await r.arrayBuffer());
  }
  async remove(file) {
    const sha = await this.sha1(file); if (!sha) return;
    await this.gh("DELETE", `/repos/${this.repo}/contents/${file}`, { body: { message: "codester: delete video", sha, branch: this.branch } });
  }
  saveVideo(name, buf) { return this.put("videos/" + name, buf, "codester: add video"); }
  fetchVideo(name) { return this.getRaw("videos/" + name); }
  removeVideo(name) { return this.remove("videos/" + name); }

  async load() {
    let txt = null;
    if (this.github) {
      const e = (await this.list("data")).find(x => x.name === "db.json");
      if (e) { this.sha = e.sha; const b = await this.getRaw(this.dataFile); if (b) txt = b.toString("utf8"); }
    } else if (fs.existsSync(this.localFile)) txt = fs.readFileSync(this.localFile, "utf8");
    // a corrupt file must stop startup: never overwrite data we could not read
    this.db = txt ? Object.assign(EMPTY(), JSON.parse(txt)) : EMPTY();
    return this.db;
  }
  touch() { this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delay); }
  flush() { this.chain = this.chain.then(() => this._flush()); return this.chain; }
  async _flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const json = JSON.stringify(this.db);
    try {
      if (this.github) await this.put(this.dataFile, json, "codester: update data");
      else { fs.mkdirSync(path.dirname(this.localFile), { recursive: true }); fs.writeFileSync(this.localFile + ".tmp", json); fs.renameSync(this.localFile + ".tmp", this.localFile); }
    } catch (e) {
      console.error("Save failed, will retry:", e.message);
      this.dirty = true; if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 10000);
    }
  }
  async close() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } await this.flush(); }
}
module.exports = Store;
