import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { MIME } from "./config.mjs";

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(text);
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export async function handleStatic(req, res, url) {
  const root = resolve(process.cwd());
  const filePath = url.pathname === "/" ? "dist/index.html" : url.pathname.slice(1);
  const candidates =
    url.pathname === "/"
      ? [resolve(root, "dist/index.html"), resolve(root, "index.html")]
      : [resolve(root, filePath), resolve(root, "dist", filePath)];

  const full = candidates.find((candidate) => candidate.startsWith(root));
  if (!full) return sendText(res, 403, "Forbidden");

  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue;
    try {
      const ext = extname(candidate).toLowerCase();
      const body = await readFile(candidate);
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      res.end(body);
      return;
    } catch {
      // Try next candidate.
    }
  }

  sendText(res, 404, "Not found");
}
