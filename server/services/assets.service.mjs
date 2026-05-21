import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { chooseFolder, listAssets, safeDir, safeImagePath, saveUploadedAssets } from "../assets.mjs";
import { DEFAULT_DIR, IMAGE_EXTS, MIME } from "../config.mjs";

function serviceError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.responseBody = { error: message };
  return error;
}

export async function getAssetList(dir) {
  try {
    const targetDir = safeDir(dir || DEFAULT_DIR);
    return { dir: targetDir, assets: await listAssets(targetDir) };
  } catch (error) {
    throw serviceError(error.message || "Unable to list assets", 400);
  }
}

export async function selectAssetFolder(dir) {
  try {
    if (process.platform !== "darwin") {
      return safeDir(dir || DEFAULT_DIR);
    }
    return await chooseFolder(dir || DEFAULT_DIR);
  } catch (error) {
    throw serviceError(error.message || "Folder selection failed", 400);
  }
}

export async function uploadAssetImages(req) {
  try {
    return await saveUploadedAssets(req);
  } catch (error) {
    throw serviceError(error.message || "Image upload failed", 400);
  }
}

export function getImageStream(dir, name) {
  let filePath;
  try {
    filePath = safeImagePath(dir || DEFAULT_DIR, name);
  } catch (error) {
    return { jsonError: error.message || "Image not found", status: 404 };
  }
  const ext = extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    return { error: "Unsupported image", status: 415 };
  }
  return {
    stream: createReadStream(filePath),
    contentType: MIME[ext] || "application/octet-stream",
  };
}
