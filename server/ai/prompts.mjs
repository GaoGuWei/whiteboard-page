import { TEMPLATE_LABELS } from "../config.mjs";

export function sectionLabel(section) {
  const imageList = section.assets?.length
    ? section.assets.map((asset, index) => `${index + 1}.《${asset.name}》`).join("\n  ")
    : "未放入截图";
  const note = section.note?.trim() ? section.note.trim() : "无额外教学目标";
  return `### ${section.title}\n- 教学目标：${note}\n- 截图顺序：\n  ${imageList}`;
}

export function buildAnalysisPrompt(payload) {
  return [
    "你是一名中文数学教研员。请先读取和分析教学白板中的截图，不要生成逐字稿。",
    "",
    "硬性要求：",
    "1. 必须输出 Markdown。",
    "1.1 不要把整份回答包在 ```markdown 或任何代码围栏中。",
    "2. 必须严格按照白板模块顺序分析：一、复习检测；二、兴趣构建；三、知识讲解；四、思维导图；五、效果检测。",
    "3. 每个模块都要包含：截图读取、题干转写、问题转写、选项转写、题目/知识点、核心考点、解题思路、课堂提问点、易错点。",
    "4. 如果同一模块有多张截图，必须按截图顺序逐张分析，不能调换顺序。",
    "5. 看不清的内容必须标注“未能清晰识别”，不要编造具体数字或题干。",
    "6. 若涉及一次函数、二次函数、反比例函数、幂函数，请额外分析函数类型、图像性质、关键点、单调性、对称性、渐近线或开口方向。",
    "7. 数学公式请使用类 LaTeX 语法，例如 $x^2$、$a_i$、$\\frac{a}{b}$、$\\sqrt{x}$。",
    "8. 对题目问题部分必须逐字转写，特别区分 $nm$、$n^m$、$n*m$、$n m$，不能把指数误写成乘法。",
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
    "你是一名中文数学题截图识别员。请只识别当前这一张图片，不要分析其他图片，不要生成逐字稿。",
    "",
    "输出要求：必须输出 Markdown，不要代码围栏。",
    "",
    "必须包含以下字段：",
    `- 图片编号：${unit.imageId}`,
    `- 所属模块：${unit.sectionTitle}`,
    `- 图片文件：${unit.assetName}`,
    "- 题干转写：",
    "- 问题转写：",
    "- 选项转写：",
    "- 关键公式：",
    "- 初步知识点：",
    "",
    "识别要求：",
    "1. 数学表达式必须使用 $...$ 或 $$...$$。",
    "2. 对问题部分逐字转写，特别区分 $nm$、$n^m$、$n*m$、$n m$。",
    "3. 分式、指数、下标、根式、负号、括号和选项必须尽量忠实；看不清就写“未能清晰识别”。",
    "",
    `课程标题：${payload.title}`,
    `课型模板：${TEMPLATE_LABELS[payload.template]}`,
  ].join("\n");
}

export function buildSingleImageVerificationPrompt(unit, ocrText) {
  return [
    "你是一名数学题 OCR 校对员。请重新查看同一张原始截图，只校验下面这份识图文本中是否有需要人工确认的风险点。",
    "",
    "输出要求：必须只输出 JSON 对象，不要 Markdown，不要代码围栏。",
    "",
    'JSON 结构：{"needsReview": boolean, "summary": "一句话说明校验结论", "riskItems": [{"id": "短 id", "field": "题干|问题|选项|公式|其他", "currentText": "识图文本中的可疑内容", "suggestedText": "建议修正内容，公式用 $...$", "reason": "为什么需要人工确认", "severity": "high|medium|low"}]}',
    "",
    "高风险必须列出 riskItems：",
    "1. 指数/上标/下标疑似错误，例如把 $n^m$ 写成 $nm$、$n*m$ 或 $n m$。",
    "2. 分式、根式、括号、负号、选项内容或题目问法疑似错误。",
    "3. 题干主体正确但问题部分可能改变数学含义。",
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
    "你是一名中文数学教研员。请基于“已确认的逐图识别结果”做整体教学分析，不要生成逐字稿。",
    "",
    "硬性要求：",
    "1. 必须输出 Markdown，不要代码围栏。",
    "2. 必须严格按照白板模块顺序组织：一、复习检测；二、兴趣构建；三、知识讲解；四、思维导图；五、效果检测。",
    "3. 对每个模块整合：确认后的题目内容、知识点、核心考点、解题思路、课堂提问点、易错点。",
    "4. 人工修正内容优先级最高，尤其是题目问题、指数、分式、选项和公式。",
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

export function buildTranscriptPrompt(payload, analysis) {
  return [
    "你是一名经验丰富的中文数学教师。请基于“截图分析结果”生成一份可直接用于课堂讲授的五步教学法逐字稿。",
    "",
    "核心目标：减少套话，必须围绕截图中真实题目、知识点、条件、解题思路展开。",
    "",
    "硬性要求：",
    "1. 必须输出 Markdown。",
    "1.1 不要把整份逐字稿包在 ```markdown 或任何代码围栏中。",
    "2. 必须严格按照以下白板模块顺序生成：一、复习检测；二、兴趣构建；三、知识讲解；四、思维导图；五、效果检测。",
    "3. 每个模块必须包含三个小标题：**教师话术**、**板书/展示提示**、**学生可能回答**。",
    "4. 每个模块开头要自然承接上一个模块，体现五步教学法中的模块切换串词。",
    "5. 教师话术要口语化、具体、可朗读；禁止反复使用“同学们，我们先看这一部分”这类模板句。",
    "6. 必须引用截图分析中的具体题目内容、条件、公式、知识点或易错点；若分析中标注未能识别，则用自然话术引导学生观察，不要编造。",
    "7. 如果同一模块有多张截图，必须按分析中的截图顺序依次讲解。",
    "8. 所有数学表达式必须使用 $...$ 或 $$...$$ 包裹；上标、下标、分式、根式使用类 LaTeX：$x^2$、$a_i$、$\\frac{a+b}{c}$、$\\sqrt[3]{x}$。",
    "8.1 块级公式必须使用独立三行 $$ 包裹：第一行只写 $$，第二行写公式，第三行只写 $$；不要使用 \\[...\\]。",
    "8.2 行内公式必须使用 $...$，不要使用 \\(...\\)。",
    "8.3 列表中如需展示块级公式，先写列表文字，公式另起一段；不要写成“- 题目： \\[ ... \\]”。",
    "8.4 除 graph 图像块外，不要输出普通代码块；板书/展示提示请使用 Markdown 列表、段落和公式。",
    "9. 若讲到一次函数、二次函数、反比例函数或幂函数的图像性质，才在对应模块输出一个标准 graph 代码块，字段只允许 type/expression/title/xMin/xMax/yMin/yMax/keyPoints。",
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
  ].join("\n");
}
