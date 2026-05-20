import { basename, extname } from "node:path";
import { DEFAULT_DIR, IMAGE_EXTS, SECTION_FALLBACKS, SECTION_ORDER, TEMPLATE_LABELS } from "./config.mjs";
import { safeDir } from "./assets.mjs";

export class ValidationError extends Error {
  constructor(message, warnings = []) {
    super(message);
    this.status = 400;
    this.warnings = warnings;
  }
}

export function cleanText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

export function validateGeneratePayload(payload) {
  const warnings = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ValidationError("请求体必须是 JSON 对象");
  }

  const title = cleanText(payload.title, "课堂逐字稿").slice(0, 80) || "课堂逐字稿";
  const template = TEMPLATE_LABELS[payload.template] ? payload.template : "new";
  if (payload.template && !TEMPLATE_LABELS[payload.template]) {
    warnings.push(`未知课型模板“${payload.template}”，已按“新授课”处理。`);
  }

  const imageDir = safeDir(payload.imageDir || DEFAULT_DIR);
  const incomingSections = Array.isArray(payload.sections) ? payload.sections : [];
  if (!incomingSections.length) warnings.push("未收到白板模块数据，已按空白五模块生成。");

  const byId = new Map();
  for (const section of incomingSections) {
    if (!section || typeof section !== "object") continue;
    const id = cleanText(section.id);
    if (!SECTION_ORDER.includes(id)) {
      if (id) warnings.push(`已忽略未知模块“${id}”。`);
      continue;
    }
    byId.set(id, section);
  }

  const sections = SECTION_ORDER.map((id) => {
    const section = byId.get(id) || {};
    const rawAssets = Array.isArray(section.assets) ? section.assets : [];
    const assets = [];

    for (const asset of rawAssets) {
      const name = basename(cleanText(asset?.name));
      const ext = extname(name).toLowerCase();
      if (!name || !IMAGE_EXTS.has(ext)) {
        warnings.push(`${SECTION_FALLBACKS[id]} 中有一张不支持的图片，已跳过。`);
        continue;
      }
      assets.push({
        name,
        width: Number(asset?.width || 0),
        height: Number(asset?.height || 0),
      });
    }

    return {
      id,
      title: cleanText(section.title, SECTION_FALLBACKS[id]),
      note: cleanText(section.note),
      assets,
    };
  });

  return { title, template, imageDir, sections, warnings };
}
