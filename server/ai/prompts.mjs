import { TEMPLATE_LABELS } from "../config.mjs";
import { mathSkill } from "./skills/math/index.mjs";

function rules(...groups) {
  return groups.flat().filter(Boolean);
}

function numberedRules(...groups) {
  return rules(...groups).map((rule, index) => `${index + 1}. ${rule}`);
}

function bulletRules(...groups) {
  return rules(...groups).map((rule) => `- ${rule}`);
}

const MATH_GRAPH_JSON_SCHEMA = [
  "```math-graph-json",
  JSON.stringify({
    version: "1",
    role: "option_graph|problem_graph|auxiliary_graph",
    label: "A",
    graphType: "geometry_triangle|geometry_quadrilateral|geometry_circle|conic_ellipse|conic_hyperbola|conic_parabola|function|qualitative_curve|coordinate_geometry",
    source: "original_image",
    confidence: 0.82,
    rawDescription: "原图中可见的图形外观与数学结构描述",
    unclearItems: ["半径未标明", "刻度不清晰"],
    title: "图像标题",
    axes: {
      xMin: -3,
      xMax: 3,
      yMin: -2,
      yMax: 2,
      xLabel: "x",
      yLabel: "y",
      dashedLines: [{ axis: "y", value: 1, label: "y=1" }],
      asymptotes: [{ axis: "x", value: 0, label: "x=0" }],
    },
    points: [{ x: 0, y: 0, label: "O" }, { x: 1, y: 0, label: "A" }],
    segments: [{ from: "A", to: "B", label: "AB" }],
    lines: [{ from: [0, 0], to: [1, 1], dashed: true, label: "辅助线" }],
    circles: [{ center: "O", radius: 1, label: "圆 O" }],
    ellipses: [{ center: [0, 0], rx: 2, ry: 1, label: "椭圆" }],
    parabolas: [{ vertex: [0, 0], orientation: "up", label: "抛物线" }],
    hyperbolas: [{ center: [0, 0], orientation: "horizontal", asymptotes: ["y=x", "y=-x"], label: "双曲线" }],
    polygons: [{ type: "triangle|quadrilateral", vertices: ["A", "B", "C"], label: "三角形 ABC" }],
    angleMarks: [{ vertex: "A", points: ["B", "C"], label: "∠A" }],
    rightAngleMarks: [{ vertex: "A", points: ["B", "C"] }],
    equalMarks: [{ items: ["AB", "AC"], type: "segment" }],
    curves: [{
      type: "explicit|parametric|conic|qualitative",
      expression: "tanh(x)",
      x: "cos(t)",
      y: "sin(t)",
      kind: "circle|ellipse|hyperbola|parabola",
      features: ["递增", "过原点", "有水平渐近线"],
    }],
    annotations: [{ x: 1, y: 1, text: "标注" }],
    qualitativeFeatures: ["单调性、对称性、截距、极值、渐近线、开口方向、圆心、焦点、准线、边角关系等"],
  }),
  "```",
].join("\n");

export function sectionLabel(section) {
  const imageList = section.assets?.length
    ? section.assets.map((asset, index) => `${index + 1}.《${asset.name}》`).join("\n  ")
    : "未放入截图";
  const note = section.note?.trim() ? section.note.trim() : "无额外教学目标";
  return `### ${section.title}\n- 教学目标：${note}\n- 截图顺序：\n  ${imageList}`;
}

export function buildAnalysisPrompt(payload) {
  return [
    mathSkill.roles.overallAnalysis,
    "请先读取和分析教学白板中的截图，不要生成逐字稿。",
    "",
    "硬性要求：",
    "1. 必须输出 Markdown。",
    "1.1 不要把整份回答包在 ```markdown 或任何代码围栏中。",
    "2. 必须严格按照白板模块顺序分析：一、复习检测；二、兴趣构建；三、知识讲解；四、思维导图；五、效果检测。",
    "3. 每个模块都要包含：截图读取、题干转写、问题转写、选项转写、题目/知识点、核心考点、解题思路、课堂提问点、易错点。",
    "",
    "数学分析要求：",
    ...numberedRules(
      mathSkill.commonRules.imageOrder,
      mathSkill.commonRules.uncertainty,
      mathSkill.commonRules.mathNotation,
      mathSkill.taskRules.overallAnalysis,
      mathSkill.topicRules.geometry,
      mathSkill.topicRules.function,
      mathSkill.topicRules.algebra,
    ),
    "",
    `课程标题：${payload.title}`,
    `课型模板：${TEMPLATE_LABELS[payload.template]}`,
    "",
    "白板模块与截图顺序：",
    payload.sections.map(sectionLabel).join("\n\n"),
  ].join("\n");
}

export function buildSingleImageAnalysisPrompt(payload, unit) {
  return [
    mathSkill.roles.imageAnalysis,
    "",
    "输出要求：必须输出 Markdown，不要代码围栏。",
    "",
    "必须包含以下字段：",
    `- 图片编号：${unit.imageId}`,
    `- 所属模块：${unit.sectionTitle}`,
    `- 图片文件：${unit.assetName}`,
    "- 图片内容类型：题目|讲解",
    "- 类型判断依据：",
    "- 题干转写：",
    "- 问题转写：",
    "- 选项转写：",
    "- 关键公式：",
    "- 初步知识点：",
    "- 图形结构化转写：",
    "",
    "识别要求：",
    ...numberedRules(
      mathSkill.commonRules.mathNotation,
      mathSkill.commonRules.uncertainty,
      mathSkill.taskRules.singleImageAnalysis,
      mathSkill.topicRules.geometry,
      mathSkill.topicRules.function,
      mathSkill.topicRules.trigonometry,
      mathSkill.topicRules.conic,
    ),
    "",
    "图片类型判断要求：",
    "1. 如果图片主要包含需要学生作答的题干、设问、选项、求证/求解目标，图片内容类型写“题目”。",
    "2. 如果图片主要包含概念说明、知识点讲解、例题解析过程、板书说明、方法总结或无需单独生成题目包的讲解素材，图片内容类型写“讲解”。",
    "3. 同时包含题目和解析时，如果仍需要围绕该题生成完整题目包，写“题目”；如果只是课堂讲解材料或已完整解释的板书，写“讲解”。",
    "4. 必须在“类型判断依据”中用一句话说明判断理由。",
    "",
    "图形识别要求：",
    "1. 只要当前图片中出现可绘制数学图形，包括圆、椭圆、三角形、四边形、双曲线、抛物线、函数曲线、坐标系图像、选项小图，就必须在“图形结构化转写”中输出一个或多个 math-graph-json 代码块。",
    "2. 不能只用自然语言描述图形；自然语言说明可以保留，但必须配套可渲染的 math-graph-json。",
    "3. 如果无法精确识别坐标、长度、半径、角度或刻度，仍要输出 qualitative/approximate 结构，并在 unclearItems 中说明不确定项。",
    "4. 只有当前图片完全没有任何可绘制数学图形时，才允许写“无可绘制图形”。",
    "5. 如果题目选项包含小图，必须为 A/B/C/D 每个带图选项输出独立的 math-graph-json 代码块，role=option_graph，label 写对应选项字母。",
    "6. 若题干给出函数表达式，必须结合表达式判断图像关键特征，不只描述图片外观。",
    "7. 对函数或三角函数图像，必须识别坐标轴、曲线走势、虚线、截距、单调性、对称性、渐近线、周期、相位、振幅、零点和关键点。",
    "8. 对圆锥曲线图像，必须识别椭圆/双曲线/抛物线类型、中心/焦点/准线/渐近线、顶点、开口方向、直线交点、动点轨迹等结构。",
    "9. 对几何图形，必须识别点、线段、直线、圆、三角形、四边形、角标记、直角标记、等长/等角标记和文字标注。",
    "10. math-graph-json 必须是合法 JSON；不要在 JSON 中写注释；必须包含 version、role、label、graphType、source、confidence、rawDescription、unclearItems。",
    "",
    "math-graph-json 示例格式：",
    MATH_GRAPH_JSON_SCHEMA,
    "",
    `课程标题：${payload.title}`,
    `课型模板：${TEMPLATE_LABELS[payload.template]}`,
  ].join("\n");
}

export function buildSingleImageVerificationPrompt(unit, ocrText) {
  return [
    mathSkill.roles.verification,
    "",
    "输出要求：必须只输出 JSON 对象，不要 Markdown，不要代码围栏。",
    "",
    'JSON 结构：{"needsReview": boolean, "summary": "一句话说明校验结论", "riskItems": [{"id": "短 id", "field": "题干|问题|选项|公式|图像|几何图|选项图|坐标系|曲线|其他", "currentText": "识图文本中的可疑内容", "suggestedText": "建议修正内容，公式用 $...$", "reason": "为什么需要人工确认", "severity": "high|medium|low"}]}',
    "",
    "高风险必须列出 riskItems：",
    ...numberedRules(
      mathSkill.taskRules.verification,
      mathSkill.commonRules.mathNotation,
      mathSkill.commonRules.uncertainty,
      mathSkill.topicRules.function,
      mathSkill.topicRules.trigonometry,
      mathSkill.topicRules.conic,
    ),
    "",
    "图形校验要求：",
    "1. 如果 OCR 文本描述了圆、椭圆、三角形、四边形、双曲线、抛物线、函数图像、坐标系图像或选项图，但没有对应的 math-graph-json，必须标记 high 风险。",
    "2. 如果原图包含选项内图像，但识图文本没有为每个带图选项提供独立 math-graph-json，必须标记 high 风险。",
    "3. 如果 math-graph-json 不是合法 JSON，或缺少 version、role、label、graphType、source、confidence、rawDescription、unclearItems 等关键字段，必须标记风险。",
    "4. 如果图形 JSON 与原图关键特征不一致，例如抛物线开口方向错误、双曲线渐近线缺失、圆心/焦点/顶点/坐标轴方向缺失，必须标记 medium 或 high 风险。",
    "5. 如果题干表达式与图像单调性、截距、渐近线、周期、焦点、准线、开口方向等特征冲突，必须标记风险。",
    "6. 如果图像无法确认，必须给出 needsReview=true，不要替用户猜测通过。",
    "",
    "如果无风险，返回 needsReview=false 且 riskItems=[]。",
    "",
    `图片编号：${unit.imageId}`,
    `所属模块：${unit.sectionTitle}`,
    `图片文件：${unit.assetName}`,
    "",
    "识图文本：",
    ocrText,
  ].join("\n");
}

export function confirmedImagesToMarkdown(images) {
  return images
    .map((image) => {
      const corrections = image.corrections?.length
        ? image.corrections
            .map((item) => `  - ${item.field}：${item.correctedText}${item.originalText ? `（原识别：${item.originalText}）` : ""}`)
            .join("\n")
        : "  - 无人工修正";
      return [
        `## ${image.sectionTitle || image.sectionId || "未命名模块"} - ${image.assetName || image.imageId}`,
        `- 图片编号：${image.imageId}`,
        `- 模块顺序：第 ${image.order} 张`,
        `- 图片内容类型：${image.contentType === "explanation" ? "讲解" : "题目"}`,
        "- 确认后的风险点修正：",
        corrections,
        "- 原始识图文本：",
        image.ocrText || "未提供",
      ].join("\n");
    })
    .join("\n\n");
}

export function buildOverallAnalysisPrompt(payload, confirmedImages) {
  return [
    mathSkill.roles.overallAnalysis,
    "请基于“已确认的逐图识别结果”做整体教学分析，不要生成逐字稿。",
    "",
    "硬性要求：",
    "1. 必须输出 Markdown，不要代码围栏。",
    "2. 必须严格按照白板模块顺序组织：一、复习检测；二、兴趣构建；三、知识讲解；四、思维导图；五、效果检测。",
    "3. 对每个模块整合：确认后的题目内容、知识点、核心考点、解题思路、课堂提问点、易错点。",
    "",
    "数学分析要求：",
    ...numberedRules(
      mathSkill.commonRules.confirmedContentPriority,
      mathSkill.commonRules.imageOrder,
      mathSkill.commonRules.mathNotation,
      mathSkill.taskRules.overallAnalysis,
      mathSkill.topicRules.geometry,
      mathSkill.topicRules.function,
      mathSkill.topicRules.algebra,
    ),
    "",
    `课程标题：${payload.title}`,
    `课型模板：${TEMPLATE_LABELS[payload.template]}`,
    "",
    "白板模块与截图顺序：",
    payload.sections.map(sectionLabel).join("\n\n"),
    "",
    "已确认的逐图识别结果：",
    confirmedImagesToMarkdown(confirmedImages),
  ].join("\n");
}

export function solutionsToMarkdown(solutions = []) {
  if (!Array.isArray(solutions) || !solutions.length) return "未生成完整题目包。";
  return solutions
    .map((solution, index) => {
      const geometry = solution.geometryAnalysis || {};
      return [
        `## 完整题目 ${index + 1}：${solution.problemId || "未命名题目"}`,
        `- 图片编号：${solution.imageId || "unknown"}`,
        `- 图片文件：${solution.assetName || "unknown"}`,
        `- 图片顺序：${solution.order || index + 1}`,
        `- 所属模块：${solution.sectionId || "unknown"}`,
        `- 题型 problemType：${solution.problemType || "unknown"}`,
        `- 知识领域 topicType：${solution.topicType || "unknown"}`,
        `- 答案来源：${solution.solutionSource || "unknown"}`,
        `- 图片是否已有答案：${solution.hasProvidedAnswer ? "是" : "否"}`,
        "- 题干：",
        solution.problemText || "未能清晰识别",
        "- 图片原有答案：",
        solution.providedAnswer || "无",
        "- 图片原有解析/步骤：",
        ...(Array.isArray(solution.providedSolutionSteps) && solution.providedSolutionSteps.length ? solution.providedSolutionSteps.map((step, stepIndex) => `  ${stepIndex + 1}. ${step}`) : ["  1. 无"]),
        `- 最终答案：${solution.finalAnswer || "未给出"}`,
        "- 解题步骤：",
        ...(Array.isArray(solution.solutionSteps) && solution.solutionSteps.length ? solution.solutionSteps.map((step, stepIndex) => `  ${stepIndex + 1}. ${step}`) : ["  1. 未给出完整步骤"]),
        "- 几何分析：",
        `  - 已知条件：${Array.isArray(geometry.given) && geometry.given.length ? geometry.given.join("；") : "无"}`,
        `  - 图形关系：${Array.isArray(geometry.diagramRelations) && geometry.diagramRelations.length ? geometry.diagramRelations.join("；") : "无"}`,
        `  - 求证/求解目标：${geometry.target || "无"}`,
        `  - 可能辅助线：${Array.isArray(geometry.auxiliaryLines) && geometry.auxiliaryLines.length ? geometry.auxiliaryLines.join("；") : "无"}`,
        `  - 使用定理：${Array.isArray(geometry.theorems) && geometry.theorems.length ? geometry.theorems.join("；") : "无"}`,
        "  - 证明链：",
        ...(Array.isArray(geometry.proofChain) && geometry.proofChain.length ? geometry.proofChain.map((step, stepIndex) => `    ${stepIndex + 1}. ${step.from || "条件"} -> ${step.reason || "依据"} -> ${step.to || "结论"}`) : ["    1. 无"]),
        "- 关键定理/方法：",
        ...(Array.isArray(solution.keyTheorems) && solution.keyTheorems.length ? solution.keyTheorems.map((item) => `  - ${item}`) : ["  - 未给出"]),
        "- 板书安排：",
        ...(Array.isArray(solution.boardWriting) && solution.boardWriting.length ? solution.boardWriting.map((item) => `  - ${item}`) : ["  - 未给出"]),
        "- 学生易错点：",
        ...(Array.isArray(solution.studentPitfalls) && solution.studentPitfalls.length ? solution.studentPitfalls.map((item) => `  - ${item}`) : ["  - 未给出"]),
      ].join("\n");
    })
    .join("\n\n");
}

export function buildProblemSolutionPrompt(payload, analysis, confirmedImages) {
  return [
    mathSkill.roles.problemSolution,
    "",
    "输出要求：必须只输出 JSON 对象，不要 Markdown，不要代码围栏。",
    "",
    "JSON 结构：",
    '{"solutions":[{"problemId":"短 id","imageId":"原图片编号","assetName":"原图片文件名","order":1,"sectionId":"review|interest|knowledge|mindmap|test","problemText":"完整题干","hasProvidedAnswer":false,"providedAnswer":"","providedSolutionSteps":["图片中已有解析步骤"],"solutionSource":"image_full_solution|image_answer_ai_steps|ai_generated|unclear","problemType":"algebra|geometry_calculation|geometry_proof|conic|function_graph|unknown","topicType":"algebra|geometry|function|conic|statistics|unknown","geometryAnalysis":{"given":["已知条件"],"diagramRelations":["图形关系"],"target":"求证/求解目标","auxiliaryLines":["可能辅助线"],"theorems":["定理"],"proofChain":[{"from":"条件","reason":"依据","to":"结论"}]},"finalAnswer":"最终答案或证明结论","solutionSteps":["步骤 1","步骤 2"],"keyTheorems":["定理或方法"],"boardWriting":["板书要点"],"studentPitfalls":["易错点"]}]}',
    "",
    "硬性要求：",
    "1. 每一道识别到的数学题都必须输出一个完整题目包，必须包含 imageId、assetName、order、problemText、finalAnswer 和 solutionSteps。",
    "1.0 只为图片内容类型为“题目”的已确认图片生成题目包；“讲解”图片只作为整体分析背景，不要为其生成题目包。",
    "1.1 imageId、assetName、order 必须来自“已确认的逐图识别结果”，用于前端显示原图，不得改写或编造。",
    "1.2 problemType 表示作答类型，例如 geometry_calculation、geometry_proof、function_graph、algebra；topicType 表示知识领域，例如 geometry、function、algebra、conic。",
    "1.3 若 topicType=geometry，必须尽量填写 geometryAnalysis；几何计算题保留 given、diagramRelations、target；只有 problemType=geometry_proof 时强制 proofChain 完整。",
    "",
    "数学题解要求：",
    ...numberedRules(
      mathSkill.commonRules.confirmedContentPriority,
      mathSkill.commonRules.mathNotation,
      mathSkill.commonRules.uncertainty,
      mathSkill.taskRules.problemSolution,
      mathSkill.topicRules.geometry,
      mathSkill.topicRules.function,
      mathSkill.topicRules.algebra,
      mathSkill.topicRules.conic,
    ),
    "",
    `课程标题：${payload.title}`,
    `课型模板：${TEMPLATE_LABELS[payload.template]}`,
    "",
    "白板模块与截图顺序：",
    payload.sections.map(sectionLabel).join("\n\n"),
    "",
    "整体分析：",
    analysis || "无整体分析",
    "",
    "已确认的逐图识别结果：",
    confirmedImagesToMarkdown(confirmedImages),
  ].join("\n");
}

export const buildSolutionPrompt = buildProblemSolutionPrompt;

export function buildSolutionRebuildPrompt(payload, confirmedImage, solution, solutionSource, rebuildGuidance) {
  return [
    mathSkill.roles.solutionRepair,
    "",
    "输出要求：必须只输出 JSON 对象，不要 Markdown，不要代码围栏。",
    "",
    "JSON 结构：",
    '{"solution":{"problemId":"短 id","imageId":"原图片编号","assetName":"原图片文件名","order":1,"sectionId":"review|interest|knowledge|mindmap|test","problemText":"完整题干","hasProvidedAnswer":false,"providedAnswer":"","providedSolutionSteps":["图片中已有解析步骤"],"solutionSource":"image_answer_ai_steps|ai_generated","problemType":"algebra|geometry_calculation|geometry_proof|conic|function_graph|unknown","topicType":"algebra|geometry|function|conic|statistics|unknown","geometryAnalysis":{"given":["已知条件"],"diagramRelations":["图形关系"],"target":"求证/求解目标","auxiliaryLines":["可能辅助线"],"theorems":["定理"],"proofChain":[{"from":"条件","reason":"依据","to":"结论"}]},"finalAnswer":"最终答案或证明结论","solutionSteps":["步骤 1","步骤 2"],"keyTheorems":["定理或方法"],"boardWriting":["板书要点"],"studentPitfalls":["易错点"]}}',
    "",
    "重构规则：",
    "1. 只重构当前这一道题目包，不要生成逐字稿，不要输出多题数组。",
    "2. 必须保留原 imageId、assetName、order、sectionId，用于前端继续匹配原图。",
    "3. 若 solutionSource=image_answer_ai_steps，必须保留图片原有答案 providedAnswer/finalAnswer，只补全或重构 solutionSteps、keyTheorems、boardWriting、studentPitfalls。",
    "4. 若 solutionSource=ai_generated，基于已确认识别内容重新生成完整题解和最终答案。",
    "5. 教师的解析重构引导优先级高，但不得覆盖图片中已明确给出的答案。",
    "6. 如果题干仍不清晰，不得编造，finalAnswer 写“无法确定”，并说明缺失信息。",
    "",
    "数学修复要求：",
    ...numberedRules(
      mathSkill.commonRules.confirmedContentPriority,
      mathSkill.commonRules.mathNotation,
      mathSkill.commonRules.uncertainty,
      mathSkill.taskRules.solutionRepair,
      mathSkill.topicRules.geometry,
      mathSkill.topicRules.function,
      mathSkill.topicRules.algebra,
      mathSkill.topicRules.conic,
    ),
    "",
    `课程标题：${payload.title}`,
    `课型模板：${TEMPLATE_LABELS[payload.template]}`,
    `答案来源：${solutionSource}`,
    "",
    "教师解析重构引导：",
    rebuildGuidance || "无额外引导",
    "",
    "已确认识别内容：",
    confirmedImagesToMarkdown([confirmedImage]),
    "",
    "当前题目包：",
    JSON.stringify({ solution }, null, 2),
  ].join("\n");
}

export function buildSolutionValidationPrompt(payload, solutions) {
  return [
    mathSkill.roles.solutionValidation,
    "",
    "输出要求：必须只输出 JSON 对象，不要 Markdown，不要代码围栏。",
    "",
    "JSON 结构：",
    '{"passed":true,"items":[{"problemId":"题目 id","passed":true,"missing":["problemText|finalAnswer|completeProof|answerConsistency|matchesQuestion|geometryAnalysis"],"reason":"简短原因"}],"summary":"一句话总结"}',
    "",
    "检查标准：",
    "只在以下问题出现时写入 missing，不要输出 validSource、validProblemType、validTopicType、usesConditions 等内部结构型提示：",
    "1. problemText：题干为空。",
    "2. finalAnswer：最终答案为空。",
    "3. completeProof：解题步骤为空，或几何证明题缺证明链。",
    "4. answerConsistency：图片已有答案时，最终答案和原图答案不一致。",
    "5. matchesQuestion：非“题干不清”场景下，最终答案仍写“无法确定/未给出/不确定”。",
    "6. geometryAnalysis：几何题缺已知条件、图形关系或目标。",
    "reason 必须写教师能理解的中文具体原因，不要直接输出 missing key。",
    "",
    "数学审核要求：",
    ...numberedRules(mathSkill.taskRules.solutionValidation, mathSkill.topicRules.geometry),
    "",
    `课程标题：${payload.title}`,
    "",
    "待审核题解：",
    JSON.stringify({ solutions }, null, 2),
  ].join("\n");
}

export function buildSolutionRepairPrompt(payload, analysis, solutions, validation) {
  return [
    mathSkill.roles.solutionRepair,
    "",
    "输出要求：必须只输出与原结构一致的 JSON 对象，不要 Markdown，不要代码围栏。",
    "",
    "必须保证每道题包含 problemText、solutionSource、problemType、topicType、finalAnswer、solutionSteps、keyTheorems、boardWriting、studentPitfalls。",
    "若 topicType=geometry，尽量补齐 geometryAnalysis；若 problemType=geometry_proof，必须补齐 target、theorems、proofChain。",
    "",
    "数学修复要求：",
    ...numberedRules(
      mathSkill.commonRules.confirmedContentPriority,
      mathSkill.taskRules.solutionRepair,
      mathSkill.topicRules.geometry,
    ),
    "",
    `课程标题：${payload.title}`,
    "",
    "整体分析：",
    analysis || "无整体分析",
    "",
    "原题解：",
    JSON.stringify({ solutions }, null, 2),
    "",
    "审核结果：",
    JSON.stringify(validation, null, 2),
  ].join("\n");
}

export function buildTranscriptPrompt(payload, analysis, solutions = []) {
  return [
    mathSkill.roles.transcript,
    "",
    "核心目标：减少套话，必须围绕截图中真实题目、知识点、条件、解题思路展开。",
    "",
    "硬性要求：",
    "1. 必须输出 Markdown。",
    "1.1 不要把整份逐字稿包在 ```markdown 或任何代码围栏中。",
    "2. 必须严格按照以下白板模块顺序生成：一、复习检测；二、兴趣构建；三、知识讲解；四、思维导图；五、效果检测。",
    "3. 每个模块必须包含三个小标题：**教师话术**、**板书/完整题解**、**学生可能回答**。",
    "4. 每个模块开头要自然承接上一个模块，体现五步教学法中的模块切换串词。",
    "5. 教师话术要口语化、具体、可朗读；禁止反复使用“同学们，我们先看这一部分”这类模板句。",
    "6. 必须引用截图分析中的具体题目内容、条件、公式、知识点或易错点；若分析中标注未能识别，则用自然话术引导学生观察，不要编造。",
    "7. 如果同一模块有多张截图，必须按分析中的截图顺序依次讲解。",
    "8. 所有数学表达式必须使用 $...$ 或 $$...$$ 包裹；上标、下标、分式、根式使用类 LaTeX：$x^2$、$a_i$、$\\frac{a+b}{c}$、$\\sqrt[3]{x}$。",
    "8.1 块级公式必须使用独立三行 $$ 包裹：第一行只写 $$，第二行写公式，第三行只写 $$；不要使用 \\[...\\]。",
    "8.2 行内公式必须使用 $...$，不要使用 \\(...\\)。",
    "8.3 列表中如需展示块级公式，先写列表文字，公式另起一段；不要写成“- 题目： \\[ ... \\]”。",
    "8.4 除 graph 图像块外，不要输出普通代码块；板书/完整题解请使用 Markdown 列表、段落和公式。",
    "9. 若讲到一次函数、二次函数、反比例函数或幂函数的图像性质，才在对应模块输出一个标准 graph 代码块，字段只允许 type/expression/title/xMin/xMax/yMin/yMax/keyPoints。",
    "10. 每道数学题必须基于“完整题目包”讲解“题解与答案”：说明题干、答案来源、最终答案、关键步骤、使用的定理/方法、板书安排和学生易错点。禁止只给课堂引导而不给完整题解。",
    "11. 已确认图片中若标注为“讲解”，其 OCR 内容应作为课堂讲解素材直接融入对应模块；若标注为“题目”，必须优先使用完整题目包中的题干、题解和答案。",
    "",
    "数学讲解要求：",
    ...numberedRules(
      mathSkill.commonRules.confirmedContentPriority,
      mathSkill.commonRules.mathNotation,
      mathSkill.taskRules.transcript,
      mathSkill.topicRules.geometry,
      mathSkill.topicRules.function,
      mathSkill.topicRules.algebra,
    ),
    "",
    `课程标题：${payload.title}`,
    `课型模板：${TEMPLATE_LABELS[payload.template]}`,
    "",
    "重要：下面的截图分析结果可能已经经过人工校正。生成逐字稿时必须以它为最高优先级，不要重新猜测题干、问题或选项。",
    "",
    "白板模块与截图顺序：",
    payload.sections.map(sectionLabel).join("\n\n"),
    "",
    "截图分析结果：",
    analysis,
    "",
    "完整题目包（必须优先使用，不得自行重解或改写图片原有答案）：",
    solutionsToMarkdown(solutions),
  ].join("\n");
}
