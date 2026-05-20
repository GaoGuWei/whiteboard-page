import { SECTION_FALLBACKS, SECTION_ORDER } from "../config.mjs";

const PIN_KEYS = new Set(["title", ...SECTION_ORDER]);
const SECTION_ALIASES = {
  review: ["一、复习检测", "1.复习检测", "第一步：复习检测", "复习检测"],
  interest: ["二、兴趣构建", "2.兴趣构建", "第二步：兴趣构建", "兴趣构建"],
  knowledge: ["三、知识讲解", "3.知识讲解", "第三步：知识讲解", "知识讲解"],
  mindmap: ["四、思维导图", "4.思维导图", "第四步：思维导图", "思维导图"],
  test: ["五、效果检测", "5.效果检测", "第五步：效果检测", "效果检测"],
};

export function normalizePinnedSections(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, pinned]) => PIN_KEYS.has(key) && Boolean(pinned))
      .map(([key]) => [key, true]),
  );
}

export function allTranscriptSectionsPinned(pinnedSections) {
  return Boolean(
    pinnedSections?.title &&
    SECTION_ORDER.every((sectionId) => pinnedSections[sectionId]),
  );
}

function findTranscriptPrefix(markdown) {
  const text = String(markdown || "");
  const match = text.match(/^#{2,4}\s+/m);
  const end = match?.index ?? text.length;
  return text.slice(0, end).trimEnd();
}

function normalizeHeading(value) {
  return String(value || "")
    .replace(/[*_`#]/g, "")
    .replace(/[（(].*?[)）]/g, "")
    .replace(/\s+/g, "")
    .replace(/[：:、.．-]/g, "")
    .trim();
}

function identifySectionId(title) {
  const normalized = normalizeHeading(title);
  for (const sectionId of SECTION_ORDER) {
    const aliases = SECTION_ALIASES[sectionId] || [SECTION_FALLBACKS[sectionId]];
    if (aliases.some((alias) => normalized.includes(normalizeHeading(alias)))) return sectionId;
  }
  return "";
}

function sectionBlocks(markdown) {
  const text = String(markdown || "");
  const matches = Array.from(text.matchAll(/^(#{2,4})\s+(.+)$/gm))
    .map((match) => ({
      index: match.index || 0,
      title: match[2].trim(),
      sectionId: identifySectionId(match[2]),
    }))
    .filter((match) => match.sectionId);
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    return {
      start,
      end,
      title: match.title,
      sectionId: match.sectionId,
      text: text.slice(start, end).trimEnd(),
    };
  });
}

function sectionBlockMap(markdown) {
  const map = new Map();
  for (const block of sectionBlocks(markdown)) {
    if (block.sectionId && !map.has(block.sectionId)) map.set(block.sectionId, block);
  }
  return map;
}

function findSectionBlock(markdown, sectionId) {
  return sectionBlockMap(markdown).get(sectionId) || null;
}

function insertMissingSection(markdown, sectionId, blockText) {
  const blocks = sectionBlockMap(markdown);
  const sectionIndex = SECTION_ORDER.indexOf(sectionId);
  for (let index = sectionIndex + 1; index < SECTION_ORDER.length; index += 1) {
    const nextBlock = blocks.get(SECTION_ORDER[index]);
    if (nextBlock) {
      return `${markdown.slice(0, nextBlock.start).trimEnd()}\n\n${blockText}\n\n${markdown.slice(nextBlock.start).trimStart()}`;
    }
  }
  return `${markdown.trimEnd()}\n\n${blockText}`;
}

export function mergePinnedTranscript(previousTranscript, nextTranscript, pinnedSections) {
  const previous = String(previousTranscript || "");
  let merged = String(nextTranscript || "");
  const warnings = [];
  if (!previous || !merged || !Object.keys(pinnedSections || {}).length) {
    return { text: merged, warnings };
  }

  if (pinnedSections.title) {
    const oldPrefix = findTranscriptPrefix(previous);
    const newPrefix = findTranscriptPrefix(merged);
    if (oldPrefix && newPrefix) {
      merged = oldPrefix + merged.slice(newPrefix.length);
    } else {
      warnings.push("标题模块已锁定，但旧稿或新稿缺少可识别的标题区，已使用新生成内容。");
    }
  }

  for (const sectionId of SECTION_ORDER) {
    if (!pinnedSections[sectionId]) continue;
    const oldBlock = findSectionBlock(previous, sectionId);
    const newBlock = findSectionBlock(merged, sectionId);
    if (oldBlock && newBlock) {
      merged = merged.slice(0, newBlock.start) + oldBlock.text + merged.slice(newBlock.end);
      warnings.push(`${SECTION_FALLBACKS[sectionId]} 已按图钉锁定保留旧稿。`);
    } else if (oldBlock) {
      merged = insertMissingSection(merged, sectionId, oldBlock.text);
      warnings.push(`${SECTION_FALLBACKS[sectionId]} 已按图钉锁定插回旧稿。`);
    } else {
      warnings.push(`${SECTION_FALLBACKS[sectionId]} 已锁定，但旧稿缺少可识别的模块标题，已使用新生成内容。`);
    }
  }

  return { text: merged, warnings };
}
