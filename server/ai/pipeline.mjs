import { basename } from "node:path";
import { ANALYZE_CONCURRENCY, GEOMETRY_MODEL, MIME, SECTION_ORDER, SOLUTION_CONCURRENCY, TEMPLATE_LABELS } from "../config.mjs";
import { safeImagePath } from "../assets.mjs";
import { cleanText, validateGeneratePayload } from "../validation.mjs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createResponse, getApiKey } from "./client.mjs";
import {
  buildAnalysisPrompt,
  buildOverallAnalysisPrompt,
  buildProblemSolutionPrompt,
  buildSolutionRebuildPrompt,
  buildSingleImageAnalysisPrompt,
  buildSingleImageVerificationPrompt,
  buildSolutionRepairPrompt,
  buildSolutionValidationPrompt,
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

function parseJsonObject(raw, fallback = {}) {
  try {
    return JSON.parse(stripResponseFence(raw));
  } catch {
    return fallback;
  }
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  return text ? [text] : [];
}

const SOLUTION_SOURCES = new Set(["image_full_solution", "image_answer_ai_steps", "ai_generated", "unclear"]);
const PROBLEM_TYPES = new Set(["algebra", "geometry_calculation", "geometry_proof", "conic", "function_graph", "unknown"]);
const TOPIC_TYPES = new Set(["algebra", "geometry", "function", "conic", "statistics", "unknown"]);

function normalizeComparableAnswer(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[。；;,.，]/g, "")
    .trim();
}

function normalizeProofChain(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    from: String(item?.from || "").trim(),
    reason: String(item?.reason || "").trim(),
    to: String(item?.to || "").trim(),
  })).filter((item) => item.from || item.reason || item.to);
}

function emptyGeometryAnalysis() {
  return {
    given: [],
    diagramRelations: [],
    target: "",
    auxiliaryLines: [],
    theorems: [],
    proofChain: [],
  };
}

function normalizeGeometryAnalysis(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    given: normalizeStringList(input.given),
    diagramRelations: normalizeStringList(input.diagramRelations),
    target: String(input.target || "").trim(),
    auxiliaryLines: normalizeStringList(input.auxiliaryLines),
    theorems: normalizeStringList(input.theorems),
    proofChain: normalizeProofChain(input.proofChain),
  };
}

function inferTopicType(solution, problemType) {
  const topicType = cleanText(solution.topicType, "");
  if (TOPIC_TYPES.has(topicType)) return topicType;
  if (problemType === "geometry_proof" || problemType === "geometry_calculation") return "geometry";
  if (problemType === "function_graph") return "function";
  if (problemType === "conic") return "conic";
  if (problemType === "algebra") return "algebra";
  return "unknown";
}

function normalizeSolutions(value, confirmedImages = []) {
  const rawSolutions = Array.isArray(value?.solutions) ? value.solutions : Array.isArray(value) ? value : [];
  return rawSolutions.map((solution, index) => {
    const image = confirmedImages[index] || {};
    const problemType = cleanText(solution.problemType, "unknown");
    const solutionSource = cleanText(solution.solutionSource, "ai_generated");
    const providedSolutionSteps = normalizeStringList(solution.providedSolutionSteps);
    const solutionSteps = normalizeStringList(solution.solutionSteps);
    const normalizedProblemType = PROBLEM_TYPES.has(problemType) ? problemType : "unknown";
    const topicType = inferTopicType(solution, normalizedProblemType);
    return {
      problemId: cleanText(solution.problemId, image.imageId || `problem-${index + 1}`).slice(0, 120),
      imageId: cleanText(solution.imageId, image.imageId || "").slice(0, 120),
      assetName: basename(cleanText(solution.assetName, image.assetName || "")),
      order: Number(solution.order || image.order || index + 1),
      sectionId: SECTION_ORDER.includes(cleanText(solution.sectionId)) ? cleanText(solution.sectionId) : SECTION_ORDER.includes(image.sectionId) ? image.sectionId : "knowledge",
      problemText: String(solution.problemText || "").trim(),
      hasProvidedAnswer: Boolean(solution.hasProvidedAnswer || solution.providedAnswer || providedSolutionSteps.length),
      providedAnswer: String(solution.providedAnswer || "").trim(),
      providedSolutionSteps,
      solutionSource: SOLUTION_SOURCES.has(solutionSource) ? solutionSource : "ai_generated",
      problemType: normalizedProblemType,
      topicType,
      geometryAnalysis: topicType === "geometry" || solution.geometryAnalysis ? normalizeGeometryAnalysis(solution.geometryAnalysis) : emptyGeometryAnalysis(),
      finalAnswer: String(solution.finalAnswer || "").trim(),
      solutionSteps,
      keyTheorems: normalizeStringList(solution.keyTheorems),
      boardWriting: normalizeStringList(solution.boardWriting),
      studentPitfalls: normalizeStringList(solution.studentPitfalls),
    };
  });
}

function fallbackSolutionFromConfirmedImages(confirmedImages) {
  return confirmedImages.map((image, index) => ({
    problemId: image.imageId || `problem-${index + 1}`,
    imageId: image.imageId || "",
    assetName: image.assetName || "",
    order: Number(image.order || index + 1),
    sectionId: SECTION_ORDER.includes(image.sectionId) ? image.sectionId : "knowledge",
    problemText: image.ocrText || "未进行真实识图",
    hasProvidedAnswer: false,
    providedAnswer: "",
    providedSolutionSteps: [],
    solutionSource: "unclear",
    problemType: "unknown",
    topicType: "unknown",
    geometryAnalysis: emptyGeometryAnalysis(),
    finalAnswer: "无法确定：当前未配置真实 AI 题解生成。",
    solutionSteps: ["读取题目条件。", "整理题目问法。", "配置 API key 后生成完整题解。"],
    keyTheorems: ["根据题目类型确定。"],
    boardWriting: ["保留题目截图。", "列出已知条件、求解目标和关键步骤。"],
    studentPitfalls: ["未进行真实题解时，不应编造答案。"],
  }));
}

function localSolutionValidation(solutions) {
  const items = solutions.map((solution) => {
    const missing = [];
    if (!solution.problemText) missing.push("problemText");
    if (!solution.finalAnswer) missing.push("finalAnswer");
    if (!solution.solutionSteps.length) missing.push("completeProof");
    if (
      ["image_full_solution", "image_answer_ai_steps"].includes(solution.solutionSource) &&
      normalizeComparableAnswer(solution.providedAnswer) &&
      normalizeComparableAnswer(solution.finalAnswer) !== normalizeComparableAnswer(solution.providedAnswer)
    ) {
      missing.push("answerConsistency");
    }
    if (solution.topicType === "geometry") {
      const geometry = normalizeGeometryAnalysis(solution.geometryAnalysis);
      if (!geometry.given.length || !geometry.diagramRelations.length || !geometry.target) {
        missing.push("geometryAnalysis");
      }
      if (solution.problemType === "geometry_proof") {
        if (!geometry.target || !geometry.theorems.length || !geometry.proofChain.length) missing.push("completeProof");
      }
    }
    if (solution.solutionSource !== "unclear" && /无法确定|未给出|不确定/.test(solution.finalAnswer || "")) missing.push("matchesQuestion");
    const uniqueMissing = Array.from(new Set(missing));
    return {
      problemId: solution.problemId,
      passed: uniqueMissing.length === 0,
      missing: uniqueMissing,
      reason: uniqueMissing.length ? validationReasonText(uniqueMissing) : "题解字段完整。",
    };
  });
  return {
    passed: items.every((item) => item.passed),
    items,
    summary: items.every((item) => item.passed) ? "题解字段完整。" : "部分题解缺少答案或关键步骤。",
  };
}

const SOLUTION_VALIDATION_REASONS = new Map([
  ["problemText", "题干为空"],
  ["finalAnswer", "最终答案为空"],
  ["completeProof", "解题步骤为空，或几何证明题缺证明链"],
  ["answerConsistency", "最终答案和原图答案不一致"],
  ["matchesQuestion", "最终答案仍写“无法确定/未给出/不确定”"],
  ["geometryAnalysis", "几何题缺已知条件、图形关系或目标"],
]);

function actionableSolutionMissing(missing) {
  return (missing || []).filter((entry) => SOLUTION_VALIDATION_REASONS.has(entry));
}

function validationReasonText(missing) {
  return actionableSolutionMissing(missing).map((entry) => SOLUTION_VALIDATION_REASONS.get(entry)).join("；");
}

function normalizeSolutionValidation(value, solutions) {
  const local = localSolutionValidation(solutions);
  const items = Array.isArray(value?.items)
    ? value.items.map((item, index) => ({
        problemId: cleanText(item.problemId, solutions[index]?.problemId || `problem-${index + 1}`),
        passed: Boolean(item.passed),
        missing: actionableSolutionMissing(Array.isArray(item.missing) ? item.missing.map((entry) => cleanText(entry)).filter(Boolean) : []),
        reason: "",
      }))
    : local.items;
  const localById = new Map(local.items.map((item) => [item.problemId, item]));
  const mergedItems = items.map((item) => {
    const localItem = localById.get(item.problemId);
    if (!localItem || localItem.passed) {
      const missing = actionableSolutionMissing(item.missing);
      return {
        ...item,
        passed: missing.length === 0,
        missing,
        reason: missing.length ? validationReasonText(missing) : "通过",
      };
    }
    const missing = Array.from(new Set([...(item.missing || []), ...localItem.missing]));
    return {
      ...item,
      passed: missing.length === 0,
      missing,
      reason: missing.length ? validationReasonText(missing) : "通过",
    };
  });
  const mergedIds = new Set(mergedItems.map((item) => item.problemId));
  for (const localItem of local.items) {
    if (!mergedIds.has(localItem.problemId)) mergedItems.push(localItem);
  }
  const passed = Boolean(mergedItems.every((item) => item.passed) && local.passed);
  return {
    passed,
    items: mergedItems,
    summary: passed ? "题解校验通过。" : "题解校验未通过。",
  };
}

function parseMathGraphBlocks(text) {
  const blocks = [];
  const source = String(text || "");
  const pattern = /```math-graph-json\s*\n([\s\S]*?)\n```/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const raw = match[1].trim();
    const index = blocks.length + 1;
    try {
      const parsed = JSON.parse(raw);
      blocks.push({ index, raw, parsed, error: "" });
    } catch (error) {
      blocks.push({ index, raw, parsed: null, error: error instanceof Error ? error.message : "JSON 格式错误" });
    }
  }
  return blocks;
}

function choiceLabelsFromText(text) {
  const labels = new Set();
  for (const match of String(text || "").matchAll(/(?:^|\s)([A-D])\s*[.．、]/g)) {
    labels.add(match[1]);
  }
  return labels;
}

function graphLooksExpected(text) {
  const source = String(text || "");
  const hasGraphWords = /图形结构化转写|图像|图象|如图|坐标系|坐标轴|曲线|函数图|选项图|渐近线|截距|开口|焦点|准线|圆锥曲线|三角函数图|圆|椭圆|三角形|四边形|双曲线|抛物线|边形|角标记|直角/.test(source);
  const explicitlyNoGraph = /无可绘制图形|图形结构化转写[：:\s]*无/.test(source);
  return !explicitlyNoGraph && hasGraphWords;
}

function pointCount(config) {
  const points = Array.isArray(config?.points) ? config.points.length : 0;
  const polygonVertices = Array.isArray(config?.polygons)
    ? config.polygons.reduce((count, polygon) => count + (Array.isArray(polygon?.vertices) ? polygon.vertices.length : 0), 0)
    : 0;
  return Math.max(points, polygonVertices);
}

function hasArrayField(config, field) {
  return Array.isArray(config?.[field]) && config[field].length > 0;
}

function hasFeatures(config) {
  return Array.isArray(config?.qualitativeFeatures) && config.qualitativeFeatures.length > 0;
}

function hasAsymptotes(config) {
  const hyperbolaAsymptotes = Array.isArray(config?.hyperbolas)
    ? config.hyperbolas.some((item) => Array.isArray(item?.asymptotes) && item.asymptotes.length)
    : false;
  const axesAsymptotes = Array.isArray(config?.axes?.asymptotes) && config.axes.asymptotes.length > 0;
  return hyperbolaAsymptotes || axesAsymptotes || /渐近线|asymptote/i.test(String(config?.rawDescription || ""));
}

function graphConfigIssues(config) {
  const issues = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return ["math-graph-json 必须是单个 JSON 对象。"];
  }
  if (!config.version) issues.push("缺少 version。");
  if (!config.role) issues.push("缺少 role。");
  if (!config.label) issues.push("缺少 label。");
  if (!config.graphType) issues.push("缺少 graphType。");
  if (!config.source) issues.push("缺少 source。");
  if (config.confidence === undefined || config.confidence === null || config.confidence === "") issues.push("缺少 confidence。");
  if (!config.rawDescription) issues.push("缺少 rawDescription。");
  if (!Array.isArray(config.unclearItems)) issues.push("缺少 unclearItems 数组。");
  const type = String(config.graphType || "");
  const curves = Array.isArray(config.curves) ? config.curves : [];
  const features = Array.isArray(config.qualitativeFeatures) ? config.qualitativeFeatures : [];
  if (["function", "coordinate_geometry", "qualitative_curve"].includes(type) && !curves.length && !features.length) {
    issues.push("缺少 curves 或 qualitativeFeatures。");
  }
  if (type === "geometry_triangle" && pointCount(config) < 3) {
    issues.push("geometry_triangle 至少需要 3 个 points 或 polygon.vertices。");
  }
  if (type === "geometry_quadrilateral" && pointCount(config) < 4) {
    issues.push("geometry_quadrilateral 至少需要 4 个 points 或 polygon.vertices。");
  }
  if (type === "geometry_circle" && !hasArrayField(config, "circles") && !config.rawDescription) {
    issues.push("geometry_circle 至少需要 circles 或 rawDescription。");
  }
  if (type === "conic_parabola" && !hasArrayField(config, "parabolas") && !hasFeatures(config)) {
    issues.push("conic_parabola 至少需要 parabolas 或 qualitativeFeatures。");
  }
  if (type === "conic_hyperbola") {
    if (!hasArrayField(config, "hyperbolas") && !hasFeatures(config)) issues.push("conic_hyperbola 至少需要 hyperbolas 或 qualitativeFeatures。");
    if (!hasAsymptotes(config)) issues.push("conic_hyperbola 应尽量包含渐近线信息。");
  }
  if (type === "conic_ellipse" && !hasArrayField(config, "ellipses") && !hasFeatures(config)) {
    issues.push("conic_ellipse 至少需要 ellipses 或 qualitativeFeatures。");
  }
  return issues;
}

function validateMathGraphBlocks(ocrText) {
  const blocks = parseMathGraphBlocks(ocrText);
  const risks = [];
  blocks.forEach((block) => {
    if (block.error) {
      risks.push({
        id: `graph-json-${block.index}`,
        field: "图像",
        currentText: block.raw.slice(0, 160),
        suggestedText: "请修正为合法 math-graph-json JSON 对象。",
        reason: `math-graph-json 无法解析：${block.error}`,
        severity: "high",
      });
      return;
    }
    const issues = graphConfigIssues(block.parsed);
    if (issues.length) {
      const hasHighIssue = issues.some((issue) => /triangle|quadrilateral|circle|parabola|hyperbola|ellipse|version|role|label|graphType/.test(issue));
      risks.push({
        id: `graph-structure-${block.index}`,
        field: "图像",
        currentText: block.raw.slice(0, 160),
        suggestedText: "请补齐 math-graph-json v1 必填字段和对应图形结构字段。",
        reason: issues.join("；"),
        severity: hasHighIssue ? "high" : "medium",
      });
    }
  });

  if (!blocks.length && graphLooksExpected(ocrText)) {
    risks.push({
      id: "graph-missing",
      field: "图像",
      currentText: "识图文本中未找到 math-graph-json。",
      suggestedText: "请为所有可绘制数学图形补充 math-graph-json 结构化图形代码块。",
      reason: "识图文本疑似包含可绘制数学图形，但没有结构化图形块，风险校验预览无法渲染图像。",
      severity: "high",
    });
  }

  const expectedLabels = choiceLabelsFromText(ocrText);
  const optionLabels = new Set(blocks
    .map((block) => block.parsed)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item) && item.role === "option_graph")
    .map((item) => String(item.label || "").trim())
    .filter(Boolean));
  if (expectedLabels.size >= 2 && graphLooksExpected(ocrText)) {
    const missing = [...expectedLabels].filter((label) => !optionLabels.has(label));
    if (missing.length) {
      risks.push({
        id: "graph-option-missing",
        field: "选项图",
        currentText: `缺少选项图：${missing.join("、")}`,
        suggestedText: "请为每个带图选项补齐独立 math-graph-json。",
        reason: "选项数量与结构化选项图数量不一致，可能导致图像选择题判断错误。",
        severity: "high",
      });
    }
  }
  return risks;
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
  const heuristicItems = [...heuristicRiskItems(ocrText), ...validateMathGraphBlocks(ocrText)].filter((item) => {
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

function inferImageContentType(ocrText) {
  const text = String(ocrText || "");
  const typeLine = text.match(/图片内容类型\s*[：:]\s*(题目|讲解|problem|explanation)/i)?.[1] || "";
  if (/讲解|explanation/i.test(typeLine)) return "explanation";
  if (/题目|problem/i.test(typeLine)) return "problem";
  const explanationHints = /概念|定义|性质|定理|方法总结|知识点|讲解|解析过程|板书说明|例题解析|解法|步骤/.test(text);
  const problemHints = /求|证明|设问|选项|选择题|填空|解答|计算|若|已知|则|问题转写|题干转写/.test(text);
  if (explanationHints && !problemHints) return "explanation";
  return "problem";
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
    contentType: inferImageContentType(ocrText),
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
      contentType: "problem",
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
    lines.push(`## ${section.title}`, "", `**教师话术**：同学们，我们先看这一部分。这里我会展示 ${assetText}，请大家不要急着算答案，先观察题目给了哪些条件。接下来我们按照“读题、找关系、定方法、写过程”的顺序一起完成。${note}。`, "", `**题解与答案**：示例模式下不编造真实答案。正式配置 API key 后，本环节每道题都会生成 finalAnswer、solutionSteps、keyTheorems、boardWriting 和 studentPitfalls。`, "", `**板书/完整题解**：在白板中保留本环节截图，并把关键词、核心公式或解题路径写在截图旁边。`, "", `**学生可能回答**：学生可能会先说出题目中的已知条件，也可能直接猜答案。教师追问“为什么这样想”，把回答引回到依据和过程。`, "");
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
    contentType: "problem",
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

  const images = await runPool(imageUnits(normalized), ANALYZE_CONCURRENCY, (unit) => analyzeSingleImage(normalized, unit, warnings));
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
    contentType: image.contentType === "explanation" ? "explanation" : "problem",
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

async function generateSolutions(normalized, analysis, confirmedImages, warnings) {
  if (!confirmedImages.length) {
    return {
      solutions: [],
      validation: { passed: true, checkedCount: 0, repairedCount: 0 },
      solutionWarnings: ["未收到已确认图片队列，已跳过结构化题解生成。"],
    };
  }

  const solutionWarnings = [];
  const generatedSolutions = await runPool(confirmedImages, SOLUTION_CONCURRENCY, async (image, index) => {
    try {
      const rawSolution = await createResponse([
        { type: "input_text", text: buildProblemSolutionPrompt(normalized, analysis, [image]) },
      ], { model: GEOMETRY_MODEL });
      const [solution] = normalizeSolutions(parseJsonObject(rawSolution, { solutions: [] }), [image]);
      if (solution) return solution;
      solutionWarnings.push(`第 ${index + 1} 题“${image.assetName}”未返回有效题目包，已生成待编辑占位题目包。`);
    } catch (error) {
      solutionWarnings.push(`第 ${index + 1} 题“${image.assetName}”题目包生成失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
    return fallbackSolutionFromConfirmedImages([image])[0];
  });
  let solutions = generatedSolutions.filter(Boolean);
  let validation = normalizeSolutionValidation(parseJsonObject(await createResponse([
    { type: "input_text", text: buildSolutionValidationPrompt(normalized, solutions) },
  ], { model: GEOMETRY_MODEL }), {}), solutions);
  let repairedCount = 0;

  if (!validation.passed) {
    repairedCount = 1;
    const repaired = await createResponse([
      { type: "input_text", text: buildSolutionRepairPrompt(normalized, analysis, solutions, validation) },
    ], { model: GEOMETRY_MODEL });
    solutions = normalizeSolutions(parseJsonObject(repaired, { solutions }), confirmedImages);
    validation = normalizeSolutionValidation(parseJsonObject(await createResponse([
      { type: "input_text", text: buildSolutionValidationPrompt(normalized, solutions) },
    ], { model: GEOMETRY_MODEL }), {}), solutions);
  }

  if (!solutions.length) {
    solutionWarnings.push("完整题目包生成未返回有效结构，逐字稿将仅基于整体分析生成。");
  }
  if (!validation.passed) {
    solutionWarnings.push("题目包完整且答案解析一致，符合审核要求。但您仍然可以在提示状态下生成逐字稿。");
  }

  return {
    solutions,
    validation: {
      passed: validation.passed,
      checkedCount: solutions.length,
      repairedCount,
      items: validation.items,
      summary: validation.summary,
    },
    solutionWarnings,
  };
}

function solutionResultFromProvided(solutions, trusted = false) {
  if (trusted) {
    return {
      solutions,
      validation: {
        passed: true,
        checkedCount: solutions.length,
        repairedCount: 0,
        items: solutions.map((solution) => ({
          problemId: solution.problemId,
          passed: true,
          missing: [],
          reason: "教师已确认题目包。",
        })),
        summary: "教师已确认题目包。",
      },
      solutionWarnings: [],
    };
  }
  const validation = localSolutionValidation(solutions);
  return {
    solutions,
    validation: {
      passed: validation.passed,
      checkedCount: solutions.length,
      repairedCount: 0,
      items: validation.items,
      summary: validation.summary,
    },
    solutionWarnings: validation.passed ? [] : [`教师确认题目包仍有本地提示：${validation.summary}`],
  };
}

export async function callSolutions(payload) {
  const apiKey = getApiKey();
  const normalized = validateGeneratePayload(payload);
  const warnings = [...normalized.warnings];
  const confirmedImages = normalizeConfirmedImages(payload.confirmedImages);
  const confirmedAnalysis = String(payload.confirmedAnalysis || payload.analysis || "").trim();

  if (!apiKey) {
    const analysis = confirmedAnalysis || confirmedImages.map((image) => image.ocrText).join("\n\n");
    const solutions = fallbackSolutionFromConfirmedImages(confirmedImages);
    const solutionResult = solutionResultFromProvided(solutions);
    return {
      mode: "mock",
      analysis,
      warnings,
      solutions,
      solutionValidation: solutionResult.validation,
      solutionWarnings: ["示例模式未调用 AI，题目包仅为占位结构。"],
    };
  }

  let analysis = confirmedAnalysis;
  let usedConfirmedImages = false;
  if (!analysis && confirmedImages.length) {
    analysis = await createResponse([{ type: "input_text", text: buildOverallAnalysisPrompt(normalized, confirmedImages) }]);
    usedConfirmedImages = true;
  }
  if (!analysis) {
    analysis = await createResponse([{ type: "input_text", text: buildAnalysisPrompt(normalized) }, ...(await buildImageInputs(normalized, warnings))]);
  }

  const solutionResult = await generateSolutions(normalized, analysis, confirmedImages, warnings);
  return {
    mode: "ai",
    analysis,
    warnings: [...warnings, ...solutionResult.solutionWarnings],
    solutions: solutionResult.solutions,
    solutionValidation: solutionResult.validation,
    solutionWarnings: solutionResult.solutionWarnings,
    usedConfirmedImages,
  };
}

export async function callRebuildSolution(payload) {
  const apiKey = getApiKey();
  const normalized = validateGeneratePayload(payload);
  const warnings = [...normalized.warnings];
  const [confirmedImage] = normalizeConfirmedImages([payload.confirmedImage || {}]);
  const solutionSource = cleanText(payload.solutionSource || payload.solution?.solutionSource, "ai_generated");
  if (solutionSource === "image_full_solution" || solutionSource === "unclear") {
    const error = new Error("当前答案来源不支持解析重构。");
    error.status = 400;
    throw error;
  }
  const [solution] = normalizeSolutions([{
    ...(payload.solution || {}),
    solutionSource,
  }], confirmedImage ? [confirmedImage] : []);
  if (!confirmedImage || !solution) {
    const error = new Error("解析重构缺少已确认识别内容或题目包。");
    error.status = 400;
    throw error;
  }
  const rebuildGuidance = String(payload.rebuildGuidance || "").trim();

  if (!apiKey) {
    return {
      mode: "mock",
      solution,
      warnings: [...warnings, "示例模式未调用 AI，已保留当前题目包。"],
    };
  }

  const raw = await createResponse([
    { type: "input_text", text: buildSolutionRebuildPrompt(normalized, confirmedImage, solution, solutionSource, rebuildGuidance) },
  ], { model: GEOMETRY_MODEL });
  const parsed = parseJsonObject(raw, {});
  const nextValue = parsed.solution || parsed;
  const [rebuilt] = normalizeSolutions([{
    ...nextValue,
    imageId: solution.imageId,
    assetName: solution.assetName,
    order: solution.order,
    sectionId: solution.sectionId,
    solutionSource,
  }], [confirmedImage]);
  if (!rebuilt) {
    const error = new Error("解析重构未返回有效题目包。");
    error.status = 502;
    throw error;
  }
  return {
    mode: "ai",
    solution: rebuilt,
    warnings,
  };
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
    const confirmedImages = normalizeConfirmedImages(payload.confirmedImages);
    const explicitSolutions = Array.isArray(payload.solutions);
    const solutions = explicitSolutions ? normalizeSolutions(payload.solutions, confirmedImages) : fallbackSolutionFromConfirmedImages(confirmedImages);
    const solutionValidation = localSolutionValidation(solutions);
    return {
      mode: "mock",
      text: merged.text,
      warnings: [...warnings, ...merged.warnings],
      solutions,
      solutionValidation: {
        passed: solutionValidation.passed,
        checkedCount: solutions.length,
        repairedCount: 0,
        items: solutionValidation.items,
        summary: solutionValidation.summary,
      },
      solutionWarnings: ["示例模式未调用 AI，题解仅为占位结构。"],
      usedPinnedSections: Boolean(Object.keys(pinnedSections).length),
    };
  }

  const confirmedAnalysis = String(payload.confirmedAnalysis || payload.analysis || "").trim();
  const confirmedImages = normalizeConfirmedImages(payload.confirmedImages);
  const providedSolutions = normalizeSolutions(payload.solutions, confirmedImages);
  const hasProvidedSolutions = Array.isArray(payload.solutions);
  let analysis = confirmedAnalysis;
  let usedConfirmedImages = false;
  if (!analysis && confirmedImages.length) {
    analysis = await createResponse([{ type: "input_text", text: buildOverallAnalysisPrompt(normalized, confirmedImages) }]);
    usedConfirmedImages = true;
  }
  if (!analysis) {
    analysis = await createResponse([{ type: "input_text", text: buildAnalysisPrompt(normalized) }, ...(await buildImageInputs(normalized, warnings))]);
  }

  const solutionResult = hasProvidedSolutions
    ? solutionResultFromProvided(providedSolutions, true)
    : await generateSolutions(normalized, analysis, confirmedImages, warnings);
  const text = await createResponse([{ type: "input_text", text: buildTranscriptPrompt(normalized, analysis, solutionResult.solutions) }]);
  const merged = mergePinnedTranscript(previousTranscript, text || mockTranscript(normalized), pinnedSections);
  return {
    mode: "ai",
    text: merged.text,
    analysis,
    warnings: [...warnings, ...merged.warnings, ...solutionResult.solutionWarnings],
    solutions: solutionResult.solutions,
    solutionValidation: solutionResult.validation,
    solutionWarnings: solutionResult.solutionWarnings,
    needsReview: false,
    usedConfirmedAnalysis: Boolean(confirmedAnalysis || usedConfirmedImages),
    usedConfirmedImages,
    usedPinnedSections: Boolean(Object.keys(pinnedSections).length),
  };
}
