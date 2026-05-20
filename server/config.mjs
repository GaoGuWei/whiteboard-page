import { loadEnvFile } from "./env.mjs";

loadEnvFile();

export const PORT = Number(process.env.PORT || 3000);
export const DEFAULT_DIR = process.env.IMAGE_DIR || "/Users/gao/Pictures/逐字稿test/因式分解";
export const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "";
export const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || "";
export const AI_BASE_URL = (
  process.env.AI_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "https://api.apiyi.com/v1"
).replace(/\/+$/, "");
export const AI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

export const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg"]);
export const TEMPLATE_LABELS = {
  new: "新授课",
  exercise: "习题讲评",
  review: "复习课",
  open: "公开课",
};

export const SECTION_ORDER = ["review", "interest", "knowledge", "mindmap", "test"];
export const SECTION_FALLBACKS = {
  review: "一、复习检测",
  interest: "二、兴趣构建",
  mindmap: "四、思维导图",
  knowledge: "三、知识讲解",
  test: "五、效果检测",
};

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};
