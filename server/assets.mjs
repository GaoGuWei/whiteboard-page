import { execFile } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_DIR,
  IMAGE_EXTS,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
  MIME,
  UPLOAD_DIR,
  UPLOAD_TTL_HOURS,
} from "./config.mjs";

export function safeDir(input) {
  return resolve(input || DEFAULT_DIR);
}

export function safeImagePath(dir, name) {
  const cleanName = basename(name || "");
  const full = resolve(join(safeDir(dir), cleanName));
  if (!full.startsWith(safeDir(dir))) throw new Error("Invalid image path");
  return full;
}

function safeUploadRoot() {
  return resolve(UPLOAD_DIR);
}

function cleanUploadName(name, index) {
  const rawName = basename(String(name || `image-${index + 1}.png`));
  const ext = extname(rawName).toLowerCase();
  const stem = basename(rawName, ext).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${stem || `image-${index + 1}`}${ext}`;
}

function uniqueName(name, used) {
  const ext = extname(name);
  const stem = basename(name, ext);
  let candidate = name;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${index}${ext}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

async function cleanupOldUploadSessions(uploadRoot) {
  try {
    const entries = await readdir(uploadRoot, { withFileTypes: true });
    const cutoff = Date.now() - UPLOAD_TTL_HOURS * 60 * 60 * 1000;
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const dirPath = resolve(join(uploadRoot, entry.name));
      if (!dirPath.startsWith(uploadRoot)) return;
      const meta = await stat(dirPath);
      if (meta.mtimeMs < cutoff) await rm(dirPath, { recursive: true, force: true });
    }));
  } catch {
    // Upload cleanup is opportunistic; a failure should not block user uploads.
  }
}

export function imageSize(buffer, ext) {
  if (ext === ".png" && buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if ((ext === ".jpg" || ext === ".jpeg") && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3 ||
        marker === 0xc5 ||
        marker === 0xc6 ||
        marker === 0xc7 ||
        marker === 0xc9 ||
        marker === 0xca ||
        marker === 0xcb ||
        marker === 0xcd ||
        marker === 0xce ||
        marker === 0xcf
      ) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }

  return { width: 0, height: 0 };
}

export async function listAssets(dir) {
  const targetDir = safeDir(dir);
  const entries = await readdir(targetDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const filePath = join(targetDir, entry.name);
    const [meta, buffer] = await Promise.all([stat(filePath), readFile(filePath)]);
    const dimensions = imageSize(buffer, ext);
    files.push({
      name: entry.name,
      width: dimensions.width,
      height: dimensions.height,
      bytes: meta.size,
      url: `/api/image?dir=${encodeURIComponent(targetDir)}&name=${encodeURIComponent(entry.name)}`,
    });
  }

  return files.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function multipartBoundary(contentType = "") {
  const match = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] || match?.[2] || "";
}

async function readRequestBuffer(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_TOTAL_BYTES) {
      throw new Error(`单次上传总大小不能超过 ${Math.round(MAX_UPLOAD_TOTAL_BYTES / 1024 / 1024)}MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(marker);
  while (cursor !== -1) {
    cursor += marker.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString("utf8");
    const nextMarker = buffer.indexOf(marker, headerEnd + 4);
    if (nextMarker === -1) break;

    let bodyEnd = nextMarker;
    if (buffer[bodyEnd - 2] === 13 && buffer[bodyEnd - 1] === 10) bodyEnd -= 2;
    const body = buffer.slice(headerEnd + 4, bodyEnd);
    const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || "";
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1] || "";
    const contentType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    if (filename) parts.push({ name, filename, contentType, body });
    cursor = nextMarker;
  }
  return parts;
}

export async function saveUploadedAssets(req) {
  const boundary = multipartBoundary(req.headers["content-type"]);
  if (!boundary) throw new Error("上传请求缺少 multipart boundary");

  const buffer = await readRequestBuffer(req);
  const parts = parseMultipart(buffer, boundary).filter((part) => part.name === "images");
  if (!parts.length) throw new Error("请选择要上传的图片");
  if (parts.length > MAX_UPLOAD_FILES) throw new Error(`单次最多上传 ${MAX_UPLOAD_FILES} 张图片`);

  const uploadRoot = safeUploadRoot();
  await mkdir(uploadRoot, { recursive: true });
  await cleanupOldUploadSessions(uploadRoot);
  const sessionDir = resolve(uploadRoot, randomUUID());
  if (!sessionDir.startsWith(uploadRoot)) throw new Error("Invalid upload directory");
  await mkdir(sessionDir, { recursive: true });

  const usedNames = new Set();
  for (const [index, part] of parts.entries()) {
    const name = uniqueName(cleanUploadName(part.filename, index), usedNames);
    const ext = extname(name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    if (part.body.length > MAX_UPLOAD_FILE_BYTES) {
      throw new Error(`“${name}”超过 ${Math.round(MAX_UPLOAD_FILE_BYTES / 1024 / 1024)}MB`);
    }
    const filePath = resolve(join(sessionDir, name));
    if (!filePath.startsWith(sessionDir)) throw new Error("Invalid upload path");
    await writeFile(filePath, part.body);
  }

  const assets = await listAssets(sessionDir);
  if (!assets.length) throw new Error("没有可用图片，请上传 PNG、JPG 或 JPEG 文件");
  return {
    dir: sessionDir,
    assets: assets.map((asset) => ({
      ...asset,
      id: `uploaded:${sessionDir}:${asset.name}`,
      source: "uploaded",
      imageDir: sessionDir,
      path: safeImagePath(sessionDir, asset.name),
    })),
  };
}

export function chooseFolder(defaultDir = DEFAULT_DIR) {
  return new Promise((resolvePath, reject) => {
    const initialDir = safeDir(defaultDir);
    const fallbackDir = existsSync(initialDir) ? initialDir : "/Users/gao/Pictures";
    const script = [
      'set chosenFolder to choose folder with prompt "选择图片素材文件夹" default location (POSIX file ' +
        JSON.stringify(fallbackDir) +
        ")",
      "POSIX path of chosenFolder",
    ].join("\n");

    execFile("osascript", ["-e", script], { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 1) {
          reject(new Error("已取消选择文件夹"));
          return;
        }
        reject(new Error(stderr.trim() || error.message || "无法打开文件夹选择窗口"));
        return;
      }
      resolvePath(stdout.trim().replace(/\/+$/, ""));
    });
  });
}

export function streamImage(res, dir, name) {
  const filePath = safeImagePath(dir, name);
  const ext = extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    return { error: "Unsupported image", status: 415 };
  }
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
  return { ok: true };
}
