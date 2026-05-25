import { useEffect, useMemo, useState } from "react";
import { renderMarkdownPreviewWithWarnings } from "../../lib/markdown";
import type { AnalysisProgress, Asset, GenerateResult, QueueImage, ReviewImage, SolutionResult } from "../../lib/types";

const SOLUTION_SOURCE_LABELS: Array<{ value: NonNullable<SolutionResult["solutionSource"]>; label: string }> = [
  { value: "image_full_solution", label: "图片已有完整题解（此选项不支持解析重构）" },
  { value: "image_answer_ai_steps", label: "图片有答案，补全过程" },
  { value: "ai_generated", label: "AI 生成题解" },
  { value: "unclear", label: "题干不清（此选项不支持解析重构）" },
];

const IMAGE_CONTENT_TYPE_LABELS: Array<{ value: NonNullable<ReviewImage["contentType"]>; label: string }> = [
  { value: "problem", label: "题目" },
  { value: "explanation", label: "讲解" },
];

type PackageValidationItem = NonNullable<NonNullable<GenerateResult["solutionValidation"]>["items"]>[number];

const SECTION_LABELS: Record<string, string> = {
  review: "回顾导入",
  interest: "兴趣激发",
  knowledge: "知识讲解",
  mindmap: "思维导图",
  test: "课堂检测",
};

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  algebra: "代数",
  geometry_calculation: "几何计算",
  geometry_proof: "几何证明",
  conic: "圆锥曲线",
  function_graph: "函数图像",
  unknown: "题型未识别",
};

const PACKAGE_WARNING_LABELS: Record<string, string> = {
  problemText: "题干为空",
  finalAnswer: "最终答案为空",
  completeProof: "解题步骤为空，或几何证明题缺证明链",
  answerConsistency: "最终答案和原图答案不一致",
  matchesQuestion: "最终答案仍写“无法确定/未给出/不确定”",
  geometryAnalysis: "几何题缺已知条件、图形关系或目标",
};

function sectionLabel(value?: string) {
  return SECTION_LABELS[value || ""] || value || "模块未识别";
}

function problemTypeLabel(value?: string) {
  return PROBLEM_TYPE_LABELS[value || ""] || value || "题型未识别";
}

function linesToText(lines?: string[]) {
  return (lines || []).join("\n");
}

function textToLines(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function normalizeComparableAnswer(value?: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[。；;，,]/g, "")
    .replace(/\$/g, "")
    .trim();
}

function emptyGeometryAnalysis(): NonNullable<SolutionResult["geometryAnalysis"]> {
  return {
    given: [],
    diagramRelations: [],
    target: "",
    auxiliaryLines: [],
    theorems: [],
    proofChain: [],
  };
}

function packageWarningText(missing?: string[]) {
  return Array.from(new Set(missing || []))
    .map((key) => PACKAGE_WARNING_LABELS[key])
    .filter(Boolean)
    .join("；");
}

function validateEditablePackage(pkg: SolutionResult): PackageValidationItem {
  const missing: string[] = [];
  const geometry = geometryAnalysis(pkg);
  const source = pkg.solutionSource || "ai_generated";
  const finalAnswer = String(pkg.finalAnswer || "").trim();
  const providedAnswer = normalizeComparableAnswer(pkg.providedAnswer);

  if (!String(pkg.problemText || "").trim()) missing.push("problemText");
  if (!finalAnswer) missing.push("finalAnswer");
  if (!(pkg.solutionSteps || []).length) missing.push("completeProof");
  if (
    ["image_full_solution", "image_answer_ai_steps"].includes(source) &&
    providedAnswer &&
    normalizeComparableAnswer(finalAnswer) !== providedAnswer
  ) {
    missing.push("answerConsistency");
  }
  if (pkg.solutionSource !== "unclear" && /无法确定|未给出|不确定/.test(finalAnswer)) missing.push("matchesQuestion");
  if (pkg.topicType === "geometry") {
    if (!geometry.given.length || !geometry.diagramRelations.length || !geometry.target) missing.push("geometryAnalysis");
    if (pkg.problemType === "geometry_proof" && (!geometry.target || !geometry.theorems.length || !geometry.proofChain.length)) {
      missing.push("completeProof");
    }
  }

  const uniqueMissing = Array.from(new Set(missing));
  return {
    problemId: pkg.problemId,
    passed: uniqueMissing.length === 0,
    missing: uniqueMissing,
    reason: uniqueMissing.length ? packageWarningText(uniqueMissing) : "题目包提示已处理。",
  };
}

function geometryAnalysis(pkg: SolutionResult) {
  return pkg.geometryAnalysis || emptyGeometryAnalysis();
}

function proofChainToText(chain: NonNullable<SolutionResult["geometryAnalysis"]>["proofChain"]) {
  if (!chain.length) return "- from: \n  reason: \n  to: ";
  return chain.map((step) => [
    `- from: ${step.from || ""}`,
    `  reason: ${step.reason || ""}`,
    `  to: ${step.to || ""}`,
  ].join("\n")).join("\n");
}

function packageToMarkdown(pkg: SolutionResult) {
  const geometry = geometryAnalysis(pkg);
  return [
    "## 题干",
    pkg.problemText || "",
    "",
    "## 图片原有答案",
    pkg.providedAnswer || "",
    "",
    "## 图片原有解析/步骤",
    linesToText(pkg.providedSolutionSteps),
    "",
    "## 最终答案",
    pkg.finalAnswer || "",
    "",
    "## 解题步骤",
    linesToText(pkg.solutionSteps),
    "",
    "## 几何分析/证明链",
    "### 已知条件",
    linesToText(geometry.given),
    "",
    "### 图形关系",
    linesToText(geometry.diagramRelations),
    "",
    "### 求证/求解目标",
    geometry.target || "",
    "",
    "### 可能辅助线",
    linesToText(geometry.auxiliaryLines),
    "",
    "### 使用定理",
    linesToText(geometry.theorems),
    "",
    "### 证明链",
    proofChainToText(geometry.proofChain),
    "",
    "## 关键方法/定理",
    linesToText(pkg.keyTheorems),
    "",
    "## 板书安排",
    linesToText(pkg.boardWriting),
    "",
    "## 学生易错点",
    linesToText(pkg.studentPitfalls),
  ].join("\n");
}

function readMarkdownSection(markdown: string, title: string) {
  const match = markdown.match(new RegExp(`^##\\s+${title}\\s*\\n([\\s\\S]*?)(?=^##\\s+|$)`, "m"));
  return (match?.[1] || "").trim();
}

function readMarkdownSubsection(markdown: string, title: string) {
  const match = markdown.match(new RegExp(`^###\\s+${title}\\s*\\n([\\s\\S]*?)(?=^###\\s+|$)`, "m"));
  return (match?.[1] || "").trim();
}

function parseProofChain(text: string) {
  const lines = text.split("\n");
  const chain: NonNullable<SolutionResult["geometryAnalysis"]>["proofChain"] = [];
  let current: { from: string; reason: string; to: string } | null = null;
  let malformed = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const from = line.match(/^-\s*from:\s*(.*)$/i);
    const reason = line.match(/^reason:\s*(.*)$/i);
    const to = line.match(/^to:\s*(.*)$/i);
    if (from) {
      if (current) chain.push(current);
      current = { from: from[1].trim(), reason: "", to: "" };
    } else if (reason && current) {
      current.reason = reason[1].trim();
    } else if (to && current) {
      current.to = to[1].trim();
    } else {
      malformed = true;
    }
  }
  if (current) chain.push(current);
  const complete = chain.filter((step) => step.from || step.reason || step.to);
  if (malformed) {
    return { chain: [], warning: "几何分析/证明链格式未能解析，已保留保存前的几何分析字段。" };
  }
  return { chain: complete, warning: "" };
}

function parseGeometryMarkdown(pkg: SolutionResult, markdown: string) {
  const section = readMarkdownSection(markdown, "几何分析/证明链");
  if (!section) return { geometry: geometryAnalysis(pkg), warning: "" };
  const proof = parseProofChain(readMarkdownSubsection(section, "证明链"));
  if (proof.warning) return { geometry: geometryAnalysis(pkg), warning: proof.warning };
  return {
    geometry: {
      given: textToLines(readMarkdownSubsection(section, "已知条件")),
      diagramRelations: textToLines(readMarkdownSubsection(section, "图形关系")),
      target: readMarkdownSubsection(section, "求证/求解目标"),
      auxiliaryLines: textToLines(readMarkdownSubsection(section, "可能辅助线")),
      theorems: textToLines(readMarkdownSubsection(section, "使用定理")),
      proofChain: proof.chain,
    },
    warning: "",
  };
}

function packageFromMarkdown(pkg: SolutionResult, markdown: string, source: SolutionResult["solutionSource"]): { package: SolutionResult; warning: string } {
  const providedAnswer = readMarkdownSection(markdown, "图片原有答案");
  const providedSolutionSteps = textToLines(readMarkdownSection(markdown, "图片原有解析/步骤"));
  const geometryResult = parseGeometryMarkdown(pkg, markdown);
  const hasGeometry = Boolean(
    geometryResult.geometry.given.length ||
    geometryResult.geometry.diagramRelations.length ||
    geometryResult.geometry.target ||
    geometryResult.geometry.auxiliaryLines.length ||
    geometryResult.geometry.theorems.length ||
    geometryResult.geometry.proofChain.length,
  );
  return {
    package: {
      ...pkg,
      solutionSource: source,
      topicType: hasGeometry ? "geometry" : pkg.topicType,
      geometryAnalysis: geometryResult.geometry,
      problemText: readMarkdownSection(markdown, "题干"),
      providedAnswer,
      providedSolutionSteps,
      hasProvidedAnswer: Boolean(providedAnswer || providedSolutionSteps.length),
      finalAnswer: readMarkdownSection(markdown, "最终答案"),
      solutionSteps: textToLines(readMarkdownSection(markdown, "解题步骤")),
      keyTheorems: textToLines(readMarkdownSection(markdown, "关键方法/定理")),
      boardWriting: textToLines(readMarkdownSection(markdown, "板书安排")),
      studentPitfalls: textToLines(readMarkdownSection(markdown, "学生易错点")),
    },
    warning: geometryResult.warning,
  };
}

interface RiskValidationProps {
  images: ReviewImage[];
  assets: Asset[];
  queue: QueueImage[];
  progress: AnalysisProgress;
  onConfirmImage: (image: ReviewImage, corrections: QueueImage["corrections"], correctedOcrText: string, contentType: QueueImage["contentType"]) => void;
  onDeleteImage: (image: ReviewImage) => void;
  onReanalyzeImage: (image: ReviewImage) => Promise<ReviewImage | void>;
  packages: SolutionResult[];
  packageValidation?: GenerateResult["solutionValidation"];
  packageWarnings: string[];
  onPackagesChange: (packages: SolutionResult[]) => void;
  onDeletePackage: (pkg: SolutionResult) => void;
  onRebuildPackage: (pkg: SolutionResult, source: SolutionResult["solutionSource"], guidance: string) => Promise<SolutionResult>;
  onGeneratePackages: () => void;
  onRegeneratePackages: () => void;
  onGenerateTranscript: () => void;
  canGenerate: boolean;
  generating: boolean;
}

export function RiskValidation({
  images,
  assets,
  queue,
  progress,
  onConfirmImage,
  onDeleteImage,
  onReanalyzeImage,
  packages,
  packageValidation,
  packageWarnings,
  onPackagesChange,
  onDeletePackage,
  onRebuildPackage,
  onGeneratePackages,
  onRegeneratePackages,
  onGenerateTranscript,
  canGenerate,
  generating,
}: RiskValidationProps) {
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const activeImage = useMemo(() => images.find((image) => image.imageId === activeImageId) || null, [activeImageId, images]);
  const [ocrDraft, setOcrDraft] = useState("");
  const [imageTypeDraft, setImageTypeDraft] = useState<QueueImage["contentType"]>("problem");
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  const [modalError, setModalError] = useState("");
  const [activePackageIndex, setActivePackageIndex] = useState<number | null>(null);
  const [packageDraft, setPackageDraft] = useState("");
  const [packageSourceDraft, setPackageSourceDraft] = useState<SolutionResult["solutionSource"]>("ai_generated");
  const [packageGuidance, setPackageGuidance] = useState("");
  const [packageParseWarning, setPackageParseWarning] = useState("");
  const [rebuildingPackage, setRebuildingPackage] = useState(false);
  const locked = generating || progress.phase === "analyzing" || progress.phase === "generating";
  const queuedIds = useMemo(() => new Set(queue.map((item) => item.imageId)), [queue]);
  const ocrPreview = useMemo(() => renderMarkdownPreviewWithWarnings(ocrDraft), [ocrDraft]);
  const packagePreview = useMemo(() => renderMarkdownPreviewWithWarnings(packageDraft), [packageDraft]);

  useEffect(() => {
    if (!activeImage) return;
    setOcrDraft(activeImage.ocrText || "");
    setImageTypeDraft(activeImage.contentType || "problem");
    setModalError("");
  }, [activeImage]);

  const assetUrl = (assetName: string) => assets.find((asset) => asset.name === assetName)?.url || "";
  const assetForPackage = (pkg: SolutionResult) => {
    if (pkg.assetName) {
      const direct = assets.find((asset) => asset.name === pkg.assetName);
      if (direct) return direct;
    }

    const imageIdParts = String(pkg.imageId || "").split(":").filter(Boolean);
    const imageFileName = imageIdParts[imageIdParts.length - 1] || "";
    if (imageFileName) {
      const byImageId = assets.find((asset) => asset.name === imageFileName);
      if (byImageId) return byImageId;
    }

    const problemId = String(pkg.problemId || "");
    const candidates = [pkg.assetName || "", imageFileName, problemId, ...problemId.split(":"), pkg.problemText || ""].filter(Boolean);
    return assets.find((asset) => candidates.some((candidate) => candidate.includes(asset.name) || asset.name.includes(candidate)));
  };
  const pendingCount = images.filter((image) => image.status !== "confirmed" && !queuedIds.has(image.imageId)).length;
  const progressPercent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const packageIssueById = useMemo(() => new Map(packages.map((pkg) => {
    const localIssue = validateEditablePackage(pkg);
    return [pkg.problemId, localIssue] as const;
  })), [packages]);
  const hasPackageWarnings = packages.some((pkg) => !validateEditablePackage(pkg).passed);
  const packageViewActive = packages.length > 0;
  const statusText = (image: ReviewImage) => {
    if (queuedIds.has(image.imageId) || image.status === "confirmed") return "已确认";
    if (image.status === "queued") return "等待中";
    if (image.status === "analyzing") return "识别中";
    if (image.status === "failed") return "识别失败";
    return "需确认";
  };
  const contentTypeLabel = (value?: ReviewImage["contentType"]) => IMAGE_CONTENT_TYPE_LABELS.find((item) => item.value === (value || "problem"))?.label || "题目";

  const updatePackage = (index: number, patch: Partial<SolutionResult>) => {
    if (locked) return;
    onPackagesChange(packages.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const openPackage = (index: number) => {
    if (locked) return;
    const pkg = packages[index];
    if (!pkg) return;
    setActivePackageIndex(index);
    setPackageDraft(packageToMarkdown(pkg));
    setPackageSourceDraft(pkg.solutionSource || "ai_generated");
    setPackageGuidance("");
    setPackageParseWarning("");
  };

  const closePackage = () => {
    setActivePackageIndex(null);
    setPackageDraft("");
    setPackageGuidance("");
    setPackageParseWarning("");
    setRebuildingPackage(false);
  };

  const savePackage = () => {
    if (activePackageIndex === null || locked) return;
    const pkg = packages[activePackageIndex];
    if (!pkg) return;
    const parsed = packageFromMarkdown(pkg, packageDraft, packageSourceDraft);
    updatePackage(activePackageIndex, parsed.package);
    if (parsed.warning) {
      setPackageParseWarning(parsed.warning);
      return;
    }
    closePackage();
  };

  const deletePackage = (pkg: SolutionResult) => {
    if (locked) return;
    const label = pkg.assetName || pkg.problemId || "该题目包";
    const ok = window.confirm(`确认从逐字稿队列中删除“${label}”吗？该操作会同步删除白板中的对应图片。`);
    if (!ok) return;
    onDeletePackage(pkg);
  };

  const packageDisplayName = (pkg: SolutionResult, index: number) => pkg.assetName || assetForPackage(pkg)?.name || `题目 ${index + 1}`;

  const rebuildDisabled = packageSourceDraft === "image_full_solution" || packageSourceDraft === "unclear";

  const rebuildPackage = async () => {
    if (activePackageIndex === null || rebuildingPackage || rebuildDisabled || locked) return;
    const pkg = packages[activePackageIndex];
    if (!pkg) return;
    setPackageParseWarning("");
    setRebuildingPackage(true);
    try {
      const parsed = packageFromMarkdown(pkg, packageDraft, packageSourceDraft);
      const rebuilt = await onRebuildPackage(parsed.package, packageSourceDraft, packageGuidance);
      updatePackage(activePackageIndex, rebuilt);
      setPackageSourceDraft(rebuilt.solutionSource || packageSourceDraft);
      setPackageDraft(packageToMarkdown(rebuilt));
    } catch (error) {
      setPackageParseWarning(error instanceof Error ? error.message : "解析重构失败");
    } finally {
      setRebuildingPackage(false);
    }
  };

  if (packageViewActive) {
    return (
      <>
        <section className="review-panel package-panel" aria-label="题目包校验">
          <div className="review-head">
            <div>
              <h3 className="review-title">题目包校验</h3>
              <p className="review-summary">
                {hasPackageWarnings ? "请确认题干、答案来源、题解与最终答案。" : "题目包已通过校验，可以生成逐字稿。"}
              </p>
            </div>
            <div className="review-actions">
              <button className="primary-btn" type="button" disabled={locked || !packages.length} onClick={onGenerateTranscript}>
                {generating ? "生成中..." : "确认题目包队列"}
              </button>
            </div>
          </div>
          {packageWarnings.length ? (
            <div className="package-warning">
              {packageWarnings.join("；")}
            </div>
          ) : null}
          <div className="package-list">
            {packages.map((pkg, index) => {
              const issue = packageIssueById.get(pkg.problemId);
              const asset = assetForPackage(pkg);
              const source = SOLUTION_SOURCE_LABELS.find((item) => item.value === (pkg.solutionSource || "ai_generated"));
              const displayName = packageDisplayName(pkg, index);
              const answerPreview = renderMarkdownPreviewWithWarnings(pkg.finalAnswer || "未填写最终答案");
              return (
                <article className={`review-card package-card ${issue && !issue.passed ? "warning" : "confirmed"}`} key={`${pkg.problemId}:${index}`}>
                  <div className="review-card-head">
                    {asset ? <img className="review-thumb" src={asset.url} alt={asset.name} /> : <div className="review-thumb package-thumb-placeholder">无图</div>}
                    <div>
                      <span className="review-card-title" title={displayName}>{displayName}</span>
                      <div className="review-card-sub">{sectionLabel(pkg.sectionId)} · {problemTypeLabel(pkg.problemType)} · {source?.label || "AI 生成题解"}</div>
                    </div>
                  </div>
                  <div className="review-summary package-answer-preview">
                    <span className="package-answer-label">本题解答：</span>
                    <span dangerouslySetInnerHTML={{ __html: answerPreview.html }} />
                  </div>
                  {issue && !issue.passed ? (
                    <p className="package-warning">
                      题目包校验提示：{packageWarningText(issue.missing)}
                    </p>
                  ) : null}
                  <div className="review-card-actions">
                    <button className="tiny-btn" type="button" disabled={locked} onClick={() => openPackage(index)}>编辑</button>
                    <button className="tiny-btn" type="button" disabled={locked} onClick={() => deletePackage(pkg)}>删除</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="risk-modal" hidden={activePackageIndex === null}>
          {activePackageIndex !== null && packages[activePackageIndex] ? (() => {
            const pkg = packages[activePackageIndex];
            const issue = packageIssueById.get(pkg.problemId);
            const asset = assetForPackage(pkg);
            const displayName = packageDisplayName(pkg, activePackageIndex);
            return (
              <div className="risk-dialog package-dialog" role="dialog" aria-modal="true" aria-label="题目包编辑">
                <div className="risk-dialog-head">
                  <h3 className="risk-dialog-title">编辑题目包</h3>
                  <button className="tiny-btn" type="button" onClick={closePackage}>关闭</button>
                </div>
                <div className="risk-dialog-body package-dialog-body">
                  <div className="risk-dialog-meta">
                    <div className="risk-image-card">
                      <div className="risk-image-info">
                        <span>{sectionLabel(pkg.sectionId)} · {problemTypeLabel(pkg.problemType)}</span>
                        <strong title={displayName}>{displayName}</strong>
                      </div>
                      {asset ? <img className="risk-dialog-thumb" src={asset.url} alt={asset.name} /> : <div className="package-image-empty">未匹配到原图</div>}
                    </div>
                    <div className="risk-ocr-pane">
                      <textarea
                        className="ocr-editor package-editor"
                        value={packageDraft}
                        disabled={rebuildingPackage || locked}
                        onChange={(event) => setPackageDraft(event.target.value)}
                        aria-label="可编辑题目包 Markdown"
                      />
                    </div>
                  </div>

                  <div className="risk-dialog-bottom">
                    <section className="risk-hints package-source-pane" aria-label="答案来源与校验提示">
                      <h4 className="risk-hints-title">答案来源</h4>
                      <select className="package-source-select" value={packageSourceDraft || "ai_generated"} disabled={locked || rebuildingPackage} onChange={(event) => setPackageSourceDraft(event.target.value)}>
                        {SOLUTION_SOURCE_LABELS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                      </select>
                      <h4 className="risk-hints-title">解析重构引导</h4>
                      <textarea
                        className="ocr-editor package-guidance-editor"
                        value={packageGuidance}
                        disabled={rebuildingPackage || locked}
                        onChange={(event) => setPackageGuidance(event.target.value)}
                        placeholder="例如：请用因式分解法；补全几何证明链；保留图片答案，只优化步骤。"
                        aria-label="解析重构引导"
                      />
                      <div className="package-review-notes">
                        {locked ? <p className="review-summary">生成中，暂不可编辑。</p> : null}
                        {rebuildDisabled ? <p className="review-summary">当前答案来源不支持解析重构。</p> : null}
                        {issue && !issue.passed ? (
                          <p className="review-summary">
                            题目包校验提示：{packageWarningText(issue.missing)}
                          </p>
                        ) : null}
                        {packageParseWarning ? <p className="review-summary">{packageParseWarning}</p> : null}
                      </div>
                    </section>
                    <section className="risk-live-preview" aria-label="题目包实时预览">
                      <div className="risk-preview-head">
                        <h4 className="risk-hints-title">实时预览</h4>
                        {packagePreview.warnings.length ? <span className="preview-warning-count">{packagePreview.warnings.length} 处警告</span> : null}
                      </div>
                      {packagePreview.warnings.length ? (
                        <div className="preview-warning">
                          有 {packagePreview.warnings.length} 处公式未能渲染，请检查 LaTeX 语法。
                        </div>
                      ) : null}
                      <div className="risk-preview-content" dangerouslySetInnerHTML={{ __html: packagePreview.html }} />
                    </section>
                  </div>
                </div>
                <div className="risk-dialog-actions">
                  <button className="ghost-btn" type="button" disabled={locked || rebuildingPackage || rebuildDisabled} onClick={rebuildPackage}>{rebuildingPackage ? "重构中..." : "解析重构"}</button>
                  <button className="primary-btn" type="button" disabled={locked || rebuildingPackage} onClick={savePackage}>保存此题</button>
                </div>
              </div>
            );
          })() : null}
        </div>
      </>
    );
  }

  return (
    <>
      <section className="review-panel" aria-label="识图校验列表">
        <div className="review-head">
          <div>
            <h3 className="review-title">识图校验</h3>
            <p className="review-summary">
              {progress.phase === "analyzing"
                ? `识别校验中 ${progress.done}/${progress.total}${progress.current ? `：${progress.current}` : ""}`
                : pendingCount ? `还有 ${pendingCount} 张图片需要确认。` : "图片已全部确认，可以进入下一步。"}
            </p>
          </div>
          <button className="primary-btn" type="button" disabled={!canGenerate || locked} onClick={onGeneratePackages}>
            {generating ? "生成中..." : "生成题目包"}
          </button>
        </div>
        {(progress.phase === "analyzing" || progress.phase === "generating") ? (
          <div className="progress-wrap" aria-label="处理进度">
            <div className="progress-bar"><span style={{ width: `${progress.phase === "generating" ? 100 : progressPercent}%` }} /></div>
            <span className="loading-dots"><i /> <i /> <i /></span>
          </div>
        ) : null}

        <div className="review-list">
          {images.length ? images.map((image) => {
            const confirmed = image.status === "confirmed" || queuedIds.has(image.imageId);
            return (
              <article className={`review-card ${confirmed ? "confirmed" : ""} ${image.status}`} key={image.imageId}>
                <div className="review-card-head">
                  <img className="review-thumb" src={assetUrl(image.assetName)} alt={image.assetName} />
                  <div>
                    <span className="review-card-title" title={image.assetName}>{image.assetName}</span>
                    <div className="review-card-sub">{image.sectionTitle} · 第 {image.order} 张 · {contentTypeLabel(image.contentType)} · {statusText(image)}{image.riskItems.length ? ` · ${image.riskItems.length} 个风险点` : ""}</div>
                  </div>
                </div>
                <p className="review-summary">{image.summary || "需要人工确认识图结果。"}</p>
                <div className="review-card-actions">
                  <button className="tiny-btn confirm-edit-btn" type="button" disabled={locked || confirmed || image.status === "queued" || image.status === "analyzing"} onClick={() => setActiveImageId(image.imageId)}>编辑确认</button>
                  <button className="tiny-btn" type="button" disabled={locked} onClick={() => onDeleteImage(image)}>删除</button>
                </div>
              </article>
            );
          }) : (
            <p className="review-summary">暂无待确认图片。</p>
          )}
        </div>
      </section>

      <div className="risk-modal" hidden={!activeImage}>
        {activeImage ? (
          <div className="risk-dialog" role="dialog" aria-modal="true" aria-label="风险点编辑">
            <div className="risk-dialog-head">
              <h3 className="risk-dialog-title">编辑识图结果</h3>
              <button className="tiny-btn" type="button" onClick={() => setActiveImageId(null)}>关闭</button>
            </div>
            <div className="risk-dialog-body">
              <div className="risk-dialog-meta">
                <div className="risk-image-card">
                  <div className="risk-image-info">
                    <span>{activeImage.sectionTitle} · 第 {activeImage.order} 张</span>
                    <strong>{activeImage.assetName}</strong>
                    <label className="package-source-pane">
                      <span className="risk-hints-title">图片类型</span>
                      <select className="package-source-select" value={imageTypeDraft || "problem"} disabled={locked || reanalyzingId === activeImage.imageId} onChange={(event) => setImageTypeDraft(event.target.value as QueueImage["contentType"])}>
                        {IMAGE_CONTENT_TYPE_LABELS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <img className="risk-dialog-thumb" src={assetUrl(activeImage.assetName)} alt={activeImage.assetName} />
                </div>
                <div className="risk-ocr-pane">
                  <textarea
                    className="ocr-editor"
                    value={ocrDraft}
                    disabled={locked || reanalyzingId === activeImage.imageId}
                    onChange={(event) => setOcrDraft(event.target.value)}
                    aria-label="可编辑识图文本"
                  />
                </div>
              </div>

              <div className="risk-dialog-bottom">
                {modalError ? <p className="status error risk-modal-error">{modalError}</p> : null}
                {locked ? <p className="review-summary risk-modal-error">生成中，暂不可编辑。</p> : null}
                <section className="risk-hints" aria-label="风险提示">
                  <h4 className="risk-hints-title">风险提示</h4>
                  {activeImage.riskItems.length ? (
                    <ol className="risk-hint-list">
                      {activeImage.riskItems.map((risk, index) => (
                        <li key={risk.id}>
                          <span className="risk-index">{index + 1}、</span>
                          <span className="risk-text">
                            <strong>{risk.field}</strong>
                            <span className="risk-severity">{risk.severity}</span>
                            {risk.reason}
                            {risk.currentText ? ` 当前识别：${risk.currentText}` : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="review-summary">当前识别结果没有风险点。如仍不放心，可以点击“再次识别”。</p>
                  )}
                </section>
                <section className="risk-live-preview" aria-label="OCR 实时预览">
                  <div className="risk-preview-head">
                    <h4 className="risk-hints-title">实时预览</h4>
                    {ocrPreview.warnings.length ? <span className="preview-warning-count">{ocrPreview.warnings.length} 处警告</span> : null}
                  </div>
                  {ocrPreview.warnings.length ? (
                    <div className="preview-warning">
                      有 {ocrPreview.warnings.length} 处公式未能渲染，请检查 LaTeX 语法。
                    </div>
                  ) : null}
                  <div className="risk-preview-content" dangerouslySetInnerHTML={{ __html: ocrPreview.html }} />
                </section>
              </div>
            </div>
            <div className="risk-dialog-actions">
              <button
                className="ghost-btn"
                type="button"
                disabled={locked || reanalyzingId === activeImage.imageId}
                onClick={async () => {
                  setModalError("");
                  setReanalyzingId(activeImage.imageId);
                  try {
                    const next = await onReanalyzeImage(activeImage);
                    if (next) {
                      setActiveImageId(next.imageId);
                      setOcrDraft(next.ocrText || "");
                    }
                  } catch (error) {
                    setModalError(error instanceof Error ? error.message : "再次识别失败");
                  } finally {
                    setReanalyzingId(null);
                  }
                }}
              >
                {reanalyzingId === activeImage.imageId ? "识别中..." : "再次识别"}
              </button>
              <button
                className="primary-btn"
                type="button"
                disabled={locked || reanalyzingId === activeImage.imageId}
                onClick={() => {
                  onConfirmImage(activeImage, [], ocrDraft, imageTypeDraft || "problem");
                  setActiveImageId(null);
                }}
              >
                确认此图
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
