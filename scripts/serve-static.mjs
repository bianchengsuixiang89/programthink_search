import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  const pathname = url.pathname === "/" ? "/search.html" : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(root, pathname));

  if (!file.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, data, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  });
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/search.html`);
});
