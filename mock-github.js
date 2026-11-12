"use strict";
// Minimal fake of the GitHub Contents API (list / read / create / update / delete) for offline tests.
const http = require("http"), crypto = require("crypto");
const files = new Map(); // path -> { buf, sha }
const sha = b => crypto.createHash("sha1").update(b).digest("hex");
function start(port, token = "test-token") {
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== "Bearer " + token) return send(401, { message: "Bad credentials" });
      const u = new URL(req.url, "http://x"), m = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(u.pathname);
      if (!m) return send(404, { message: "Not Found" });
      const p = decodeURIComponent(m[2]).replace(/\/$/, "");
      if (req.method === "GET") {
        if (files.has(p)) { const f = files.get(p);
          if (/raw/.test(req.headers.accept || "")) { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(f.buf); }
          return send(200, { type: "file", sha: f.sha, content: f.buf.toString("base64"), encoding: "base64" }); }
        const kids = [...files].filter(([k]) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/"));
        if (!kids.length) return send(404, { message: "Not Found" });
        return send(200, kids.map(([k, f]) => ({ name: k.split("/").pop(), path: k, sha: f.sha, type: "file" })));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      if (req.method === "PUT") {
        const cur = files.get(p);
        if (cur && !body.sha) return send(422, { message: "\"sha\" wasn't supplied." });
        if (cur && body.sha !== cur.sha) return send(409, { message: "does not match" });
        const buf = Buffer.from(body.content, "base64"); files.set(p, { buf, sha: sha(buf) });
        return send(cur ? 200 : 201, { content: { sha: sha(buf), path: p } });
      }
      if (req.method === "DELETE") {
        const cur = files.get(p); if (!cur) return send(404, { message: "Not Found" });
        if (body.sha !== cur.sha) return send(409, { message: "does not match" });
        files.delete(p); return send(200, {});
      }
      send(405, {});
    });
  });
  return new Promise(r => srv.listen(port, () => r({ srv, files })));
}
module.exports = { start };
if (require.main === module) start(Number(process.env.PORT || 3201)).then(() => console.log("mock GitHub on", process.env.PORT || 3201));
