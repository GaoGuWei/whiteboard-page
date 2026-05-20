import { basename } from "node:path";
import { MIME, SECTION_ORDER, TEMPLATE_LABELS } from "../config.mjs";
import { safeImagePath } from "../assets.mjs";
import { cleanText, validateGeneratePayload } from "../validation.mjs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createResponse, getApiKey } from "./client.mjs";
import {
  buildAnalysisPrompt,
  buildOverallAnalysisPrompt,
  buildSingleImageAnalysisPrompt,
  buildSingleImageVerificationPrompt,
  buildTranscriptPrompt,
} from "./prompts.mjs";
import {
  allTranscriptSectionsPinned,
  mergePinnedTranscript,
  normalizePinnedSections,
} from "./pinned-transcript.mjs";

function imageUnits(payload) {
  return payload.sections.flatMap((section) =>
    section.assets.map((asset, index) => ({
      imageId: `${section.id}:${index}:${asset.name}`,
      sectionId: section.id,
      sectionTitle: section.title,
      assetName: asset.name,
      order: index + 1,
      note: section.note,
      width: asset.width,
      height: asset.height,
    })),
  );
}

function findImageUnit(payload, imageRef = {}) {
  const units = imageUnits(payload);
  const sectionId = cleanText(imageRef.sectionId);
  const assetName = basename(cleanText(imageRef.assetName));
  const order = Number(imageRef.order || 0);
  return units.find((unit) => (
    unit.sectionId === sectionId &&
    unit.assetName === assetName &&
    (!order || unit.order === order)
  ));
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildImageInputs(payload, warnings) {
  const content = [];
  for (const section of payload.sections) {
    for (const [index, asset] of section.assets.entries()) {
      const label = `${section.title} - 第 ${index + 1} 张截图 - ${asset.name}`;
      try {
        const imagePath = safeImagePath(payload.imageDir, asset.name);
        const ext = extname(asset.name).toLowerCase();
        const buffer = await readFile(imagePath);
        content.push({ type: "input_text", text: `以下图片对应：${label}` });
        content.push({
          type: "input_image",
          image_url: `data:${MIME[ext]};base64,${buffer.toString("base64")}`,
        });
      } catch (error) {
        warnings.push(`无法读取“${label}”：${error.message}`);
      }
    }
  }
  return content;
}

async function buildSingleImageInput(payload, unit, warnings) {
  try {
    const imagePath = safeImagePath(payload.imageDir, unit.assetName);
    const ext = extname(unit.assetName).toLowerCase();
    const buffer = await readFile(imagePath);
    return [
      {
        type: "input_text",
        text: `以下图片对应：${unit.sectionTitle} - 第 ${unit.order} 张截图 - ${unit.assetName}`,
      },
      {
        type: "input_image",
        image_url: `data:${MIME[ext]};base64,${buffer.toString("base64")}`,
      },
    ];
  } catch (error) {
    warnings.push(`无法读取“${unit.sectionTitle} - ${unit.assetName}”：${error.message}`);
    return [];
  }
}

function stripResponseFence(value) {
  let text = String(value || "").trim();
  for (let index = 0; index < 2; index += 1) {
    const match = text.match(/^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/);
    if (!match) break;
    text = match[1].trim();
  }
  return text;
}

function parseRiskVerification(raw) {
  try {
    const parsed = JSON.parse(stripResponseFence(raw));
    const riskItems = Array.isArray(parsed.riskItems || parsed.reviewItems)
      ? (parsed.riskItems || parsed.reviewItems).map((item, index) => ({
          id: cleanText(item.id, `risk-${index + 1}`).slice(0, 40),
          field: cleanText(item.field, "其他").slice(0, 20),
          currentText: String(item.currentText || "").trim(),
          suggestedText: String(item.suggestedText || "").trim(),
          reason: cleanText(item.reason, "需要人工确认").slice(0, 300),
          severity: ["high", "medium", "low"].includes(cleanText(item.severity))
            ? cleanText(item.severity)
            : "medium",
        }))
      : [];
    return {
      needsReview: Boolean(parsed.needsReview || riskItems.some((item) => item.severity !== "low")),
      summary: cleanText(parsed.summary, riskItems.length ? "发现疑似识图风险" : "校验通过"),
      riskItems,
      raw,
    };
  } catch {
    return {
      needsReview: true,
      summary: "校验结果无法解析，请人工确认该图识别内容。",
      riskItems: [
        {
          id: "verification-parse",
          field: "其他",
          currentText: "",
          suggestedText: "",
          reason: "AI 校验返回了非 JSON 内容，系统无法判断该图识别是否可靠。",
          severity: "medium",
        },
      ],
      raw,
    };
  }
}

function heuristicRiskItems(ocrText) {
  const text = String(ocrText || "");
  const suspicious = [
    { pattern: /\$?n\s*\*\s*m\$?/i, current: "$n*m$", suggested: "$n^m$ 或 $nm$" },
    { pattern: /\$?n\s+times\s+m\$?/i, current: "$n \\times m$", suggested: "$n^m$ 或 $nm$" },
    { pattern: /\$?n\s+m\$?/i, current: "$n m$", suggested: "$n^m$、$nm$ 或 $n\\times m$" },
  ];
  return suspicious
    .filter((risk) => risk.pattern.test(text))
    .map((risk, index) => ({
      id: `heuristic-${index + 1}`,
      field: "问题",
      currentText: risk.current,
      suggestedText: risk.suggested,
      reason: "识图文本中出现 n 与 m 的乘法/空格写法，数学题问题部分可能原本是指数或省略乘法，需要人工确认。",
      severity: "high",
    }));
}

function mergeImageVerification(verification, ocrText) {
  const existing = new Set((verification.riskItems || []).map((item) => `${item.field}:${item.currentText}:${item.suggestedText}`));
  const heuristicItems = heuristicRiskItems(ocrText).filter((item) => {
    const key = `${item.field}:${item.currentText}:${item.suggestedText}`;
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  const riskItems = [...(verification.riskItems || []), ...heuristicItems];
  return {
    ...verification,
    needsReview: Boolean(verification.needsReview || riskItems.length),
    riskItems,
    summary:
      riskItems.length && !verification.needsReview
        ? "发现疑似数学转写风险，请人工确认。"
        : verification.summary,
  };
}

function normalizeImageUnit(unit, verification, ocrText) {
  const riskItems = verification.riskItems || [];
  const needsReview = Boolean(verification.needsReview || riskItems.length);
  return {
    imageId: unit.imageId,
    sectionId: unit.sectionId,
    sectionTitle: unit.sectionTitle,
    assetName: unit.assetName,
    order: unit.order,
    width: unit.width,
    height: unit.height,
    ocrText,
    riskItems,
    summary: verification.summary,
    status: needsReview ? "needs_review" : "confirmed",
  };
}

export async function analyzeSingleImage(normalized, unit, warnings) {
  const imageInput = await buildSingleImageInput(normalized, unit, warnings);
  if (!imageInput.length) {
    return normalizeImageUnit(unit, {
      needsReview: true,
      summary: "图片读取失败，请人工确认或重新读取素材。",
      riskItems: [{ id: "image-read", field: "其他", currentText: "", suggestedText: "", reason: "后端无法读取该图片。", severity: "high" }],
    }, "");
  }

  const ocrText = await createResponse([
    { type: "input_text", text: buildSingleImageAnalysisPrompt(normalized, unit) },
    ...imageInput,
  ]);
  const rawVerification = await createResponse([
    { type: "input_text", text: buildSingleImageVerificationPrompt(unit, ocrText) },
    ...imageInput,
  ]);
  const verification = mergeImageVerification(parseRiskVerification(rawVerification), ocrText);
  return normalizeImageUnit(unit, verification, ocrText);
}

export async function callAnalyzeImage(payload) {
  const apiKey = getApiKey();
  const normalized = validateGeneratePayload(payload);
  const warnings = [...normalized.warnings];
  const unit = findImageUnit(normalized, payload.image || payload.imageRef || payload);
  if (!unit) {
    const error = new Error("Image not found in payload");
    error.status = 400;
    throw error;
  }

  if (!apiKey) {
    return mockImageUnits(normalized).find((image) => image.imageId === unit.imageId) || {
      imageId: unit.imageId,
      sectionId: unit.sectionId,
      sectionTitle: unit.sectionTitle,
      assetName: unit.assetName,
      order: unit.order,
      width: unit.width,
      height: unit.height,
      ocrText: "未进行真实识图",
      riskItems: [],
      summary: "示例识图结果，配置 API key 后启用真实逐图校验。",
      status: "confirmed",
    };
  }

  return analyzeSingleImage(normalized, unit, warnings);
}

function mockTranscript(payload) {
  const templateTone = TEMPLATE_LABELS[payload.template] || "新授课";
  const lines = [`# ${payload.title || "课堂逐字稿"}`, "", `> 课型：${templateTone}`, `> 生成模式：本地示例生成。配置 YI_API_KEY 后会尝试调用 AI 生成。`, ""];
  for (const section of payload.sections || []) {
    const assetText = section.assets?.length
      ? section.assets.map((asset) => `“${asset.name}”`).join("、")
      : "当前板块暂未放入截图";
    const note = section.note?.trim() || "围绕本环节目标自然推进";
    lines.push(`## ${section.title}`, "", `**教师话术**：同学们，我们先看这一部分。这里我会展示 ${assetText}，请大家不要急着算答案，先观察题目给了哪些条件。接下来我们按照“读题、找关系、定方法、写过程”的顺序一起完成。${note}。`, "", `**板书/展示提示**：在白板中保留本环节截图，并把关键词、核心公式或解题路径写在截图旁边。`, "", `**学生可能回答**：学生可能会先说出题目中的已知条件，也可能直接猜答案。教师追问“为什么这样想”，把回答引回到依据和过程。`, "");
  }
  lines.push("## 课堂收束", "", "**教师话术**：今天这节课我们不是只得到几个答案，更重要的是把观察条件、选择方法、表达过程连成了一条完整路径。课后请大家用同样的方法再回看一遍自己的解题过程。");
  return lines.join("\n");
}

function mockImageUnits(normalized) {
  return imageUnits(normalized).map((unit) => ({
    imageId: unit.imageId,
    sectionId: unit.sectionId,
    sectionTitle: unit.sectionTitle,
    assetName: unit.assetName,
    order: unit.order,
    width: unit.width,
    height: unit.height,
    ocrText: [`## ${unit.sectionTitle} - ${unit.assetName}`, "- 题干转写：未进行真实识图", "- 问题转写：未进行真实识图", "- 选项转写：未进行真实识图", "- 关键公式：未进行真实识图", "- 初步知识点：未进行真实识图"].join("\n"),
    riskItems: [],
    summary: "示例识图结果，配置 API key 后启用真实逐图校验。",
    status: "confirmed",
  }));
}

export async function callAnalyze(payload) {
  const apiKey = getApiKey();
  const normalized = validateGeneratePayload(payload);
  const warnings = [...normalized.warnings];
  if (!apiKey) {
    const images = mockImageUnits(normalized);
    return { mode: "mock", images, analysis: images.map((image) => image.ocrText).join("\n\n"), needsReview: false, reviewItems: [], pendingCount: 0, confirmedCount: images.length, warnings };
  }

  const images = await runPool(imageUnits(normalized), 2, (unit) => analyzeSingleImage(normalized, unit, warnings));
  const riskImages = images.filter((image) => image.status === "needs_review");
  return {
    mode: "ai",
    images,
    analysis: images.map((image) => image.ocrText).join("\n\n"),
    verification: {
      needsReview: Boolean(riskImages.length),
      summary: riskImages.length ? `发现 ${riskImages.length} 张图片需要人工确认。` : "所有图片已通过逐图校验。",
      reviewItems: riskImages.flatMap((image) => image.riskItems.map((item) => ({ ...item, sectionId: image.sectionId, sectionTitle: image.sectionTitle, assetName: image.assetName }))),
    },
    needsReview: Boolean(riskImages.length),
    reviewItems: riskImages.flatMap((image) => image.riskItems),
    pendingCount: riskImages.length,
    confirmedCount: images.length - riskImages.length,
    warnings,
  };
}

function normalizeConfirmedImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((image, index) => ({
    imageId: cleanText(image.imageId, `confirmed-${index + 1}`).slice(0, 120),
    sectionId: SECTION_ORDER.includes(cleanText(image.sectionId)) ? cleanText(image.sectionId) : "",
    sectionTitle: cleanText(image.sectionTitle),
    assetName: basename(cleanText(image.assetName)),
    order: Number(image.order || index + 1),
    ocrText: String(image.ocrText || "").trim(),
    corrections: Array.isArray(image.corrections)
      ? image.corrections.map((item, itemIndex) => ({
          id: cleanText(item.id, `correction-${itemIndex + 1}`).slice(0, 60),
          field: cleanText(item.field, "其他").slice(0, 20),
          correctedText: String(item.correctedText || item.suggestedText || item.currentText || "").trim(),
          originalText: String(item.currentText || "").trim(),
        }))
      : [],
  })).sort((left, right) => {
    const leftSection = SECTION_ORDER.indexOf(left.sectionId);
    const rightSection = SECTION_ORDER.indexOf(right.sectionId);
    const sectionDelta = (leftSection === -1 ? 999 : leftSection) - (rightSection === -1 ? 999 : rightSection);
    if (sectionDelta) return sectionDelta;
    return left.order - right.order;
  });
}

export async function callOpenAI(payload) {
  const apiKey = getApiKey();
  const normalized = validateGeneratePayload(payload);
  const warnings = [...normalized.warnings];
  const previousTranscript = String(payload.previousTranscript || "");
  const pinnedSections = normalizePinnedSections(payload.pinnedSections);

  if (previousTranscript.trim() && allTranscriptSectionsPinned(pinnedSections)) {
    return {
      mode: apiKey ? "ai" : "mock",
      text: previousTranscript,
      warnings,
      needsReview: false,
      usedPinnedSections: true,
      skippedGeneration: true,
    };
  }

  if (!apiKey) {
    const text = mockTranscript(normalized);
    const merged = mergePinnedTranscript(previousTranscript, text, pinnedSections);
    return {
      mode: "mock",
      text: merged.text,
      warnings: [...warnings, ...merged.warnings],
      usedPinnedSections: Boolean(Object.keys(pinnedSections).length),
    };
  }

  const confirmedAnalysis = String(payload.confirmedAnalysis || payload.analysis || "").trim();
  const confirmedImages = normalizeConfirmedImages(payload.confirmedImages);
  let analysis = confirmedAnalysis;
  let usedConfirmedImages = false;
  if (!analysis && confirmedImages.length) {
    analysis = await createResponse([{ type: "input_text", text: buildOverallAnalysisPrompt(normalized, confirmedImages) }]);
    usedConfirmedImages = true;
  }
  if (!analysis) {
    analysis = await createResponse([{ type: "input_text", text: buildAnalysisPrompt(normalized) }, ...(await buildImageInputs(normalized, warnings))]);
  }

  const text = await createResponse([{ type: "input_text", text: buildTranscriptPrompt(normalized, analysis) }]);
  const merged = mergePinnedTranscript(previousTranscript, text || mockTranscript(normalized), pinnedSections);
  return {
    mode: "ai",
    text: merged.text,
    analysis,
    warnings: [...warnings, ...merged.warnings],
    needsReview: false,
    usedConfirmedAnalysis: Boolean(confirmedAnalysis || usedConfirmedImages),
    usedConfirmedImages,
    usedPinnedSections: Boolean(Object.keys(pinnedSections).length),
  };
}
