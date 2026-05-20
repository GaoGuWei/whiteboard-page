import { execFile } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { DEFAULT_DIR, IMAGE_EXTS, MIME } from "./config.mjs";

export function safeDir(input) {
  return resolve(input || DEFAULT_DIR);
}

export function safeImagePath(dir, name) {
  const cleanName = basename(name || "");
  const full = resolve(join(safeDir(dir), cleanName));
  if (!full.startsWith(safeDir(dir))) throw new Error("Invalid image path");
  return full;
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
