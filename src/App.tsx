import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Whiteboard } from "./components/Whiteboard";
import { AssetPanel } from "./components/side/AssetPanel";
import { TranscriptPanel } from "./components/side/TranscriptPanel";
import { analyzeImages, analyzeSingleImage, generateProblemPackages, generateTranscript, rebuildProblemPackage, startAnalyzeStream } from "./lib/api";
import { createImageSourceAdapter } from "./lib/imageSource";
import { renderMarkdownPreview } from "./lib/markdown";
import type { AnalysisProgress, AnalyzeStreamEvent, Asset, AssetSource, GeneratePayload, GenerateResult, ImageRef, PinKey, QueueImage, ReviewImage, SectionDefinition, SectionId, SectionsState, SolutionResult } from "./lib/types";

const SECTION_DEFINITIONS: SectionDefinition[] = [
  { id: "review", title: "一、复习检测", hint: "在此处放入复习题或检测截图" },
  { id: "interest", title: "二、兴趣构建", hint: "在此处放入情境、问题或知识点截图" },
  { id: "mindmap", title: "四、思维导图", hint: "在此处放入思维导图或结构截图" },
  { id: "knowledge", title: "三、知识讲解", hint: "在此处放入例题、公式或知识点截图", wide: true },
  { id: "test", title: "五、效果检测", hint: "在此处放入课堂练习或检测题截图" },
];
const TRANSCRIPT_SECTION_ORDER: SectionId[] = ["review", "interest", "knowledge", "mindmap", "test"];
const ANALYZE_FALLBACK_CONCURRENCY = 3;
const IMAGE_SOURCE_ADAPTER = createImageSourceAdapter();

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function orderedSectionDefinitions() {
  const byId = new Map(SECTION_DEFINITIONS.map((section) => [section.id, section]));
  return TRANSCRIPT_SECTION_ORDER.map((id) => byId.get(id)).filter(Boolean) as SectionDefinition[];
}

function assetKey(sectionId: SectionId, assetName: string) {
  return `${sectionId}:${assetName}`;
}

function emptySections(): SectionsState {
  return SECTION_DEFINITIONS.reduce((acc, section) => {
    acc[section.id] = { assets: [], note: "" };
    return acc;
  }, {} as SectionsState);
}

function sampleTranscript() {
  return [
    "# 因式分解课堂逐字稿",
    "",
    "## 一、复习检测",
    "",
    "### 教师话术",
    "我们先看这道题。先不要急着选答案，先把右边的乘积展开：",
    "",
    "$$",
    "x^2-mx-10=(x-5)(x+n)",
    "$$",
    "",
    "接下来请大家比较一次项和常数项，判断 $m$、$n$ 以及题目真正要求的是 $n^m$ 还是 $nm$。",
    "",
    "### 板书/完整题解",
    "- 展开式：$(x-5)(x+n)=x^2+(n-5)x-5n$",
    "- 常数项对应：$-5n=-10$",
    "",
    "### 学生可能回答",
    "- 先得到 $n=2$。",
    "- 再由 $n-5=-m$ 得到 $m=3$。",
  ].join("\n");
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"assets" | "transcript">("assets");
  const [activeAssetSource, setActiveAssetSource] = useState<AssetSource>(IMAGE_SOURCE_ADAPTER.initialSource);
  const [presetImageDir, setPresetImageDir] = useState("");
  const [uploadedImageDir, setUploadedImageDir] = useState("");
  const [presetAssets, setPresetAssets] = useState<Asset[]>([]);
  const [uploadedAssets, setUploadedAssets] = useState<Asset[]>([]);
  const [assetStatus, setAssetStatus] = useState(IMAGE_SOURCE_ADAPTER.initialStatus);
  const [assetStatusKind, setAssetStatusKind] = useState<"ok" | "error" | "">("");
  const [selectedAssetName, setSelectedAssetName] = useState<string | null>(null);
  const [title, setTitle] = useState("标题");
  const [template, setTemplate] = useState("new");
  const [sections, setSections] = useState<SectionsState>(() => emptySections());
  const [transcript, setTranscript] = useState("");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [transcriptStatus, setTranscriptStatus] = useState("待生成");
  const [transcriptStatusKind, setTranscriptStatusKind] = useState<"ok" | "error" | "review" | "">("");
  const [reviewImages, setReviewImages] = useState<ReviewImage[]>([]);
  const [transcriptQueue, setTranscriptQueue] = useState<QueueImage[]>([]);
  const [riskViewActive, setRiskViewActive] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>({ phase: "idle", total: 0, done: 0 });
  const [transcriptGenerated, setTranscriptGenerated] = useState(false);
  const [pinnedSections, setPinnedSections] = useState<Partial<Record<PinKey, boolean>>>({});
  const pinnedSectionsRef = useRef<Partial<Record<PinKey, boolean>>>({});
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const [problemPackages, setProblemPackages] = useState<SolutionResult[]>([]);
  const [problemPackageAnalysis, setProblemPackageAnalysis] = useState("");
  const [problemPackageValidation, setProblemPackageValidation] = useState<GenerateResult["solutionValidation"]>();
  const [problemPackageWarnings, setProblemPackageWarnings] = useState<string[]>([]);
  const assets = activeAssetSource === "uploaded" ? uploadedAssets : presetAssets;
  const imageDir = activeAssetSource === "uploaded" ? uploadedImageDir : presetImageDir;
  const sourceLabel =
    IMAGE_SOURCE_ADAPTER.mode === "local"
      ? uploadedAssets.length ? "本机已选择素材" : "请选择本机图片或文件夹"
      : activeAssetSource === "uploaded" ? "已上传素材" : "服务器示例素材";

  const usedAssetNames = useMemo(() => {
    const names = new Set<string>();
    for (const section of Object.values(sections)) for (const asset of section.assets) names.add(asset.name);
    return names;
  }, [sections]);
  const confirmedAssetKeys = useMemo(() => new Set(transcriptQueue.map((image) => assetKey(image.sectionId, image.assetName))), [transcriptQueue]);

  const loadInitialAssets = useCallback(async () => {
    setAssetStatus(IMAGE_SOURCE_ADAPTER.mode === "local" ? "请选择本机图片或文件夹。" : "正在读取服务器示例素材...");
    setAssetStatusKind("");
    try {
      const result = await IMAGE_SOURCE_ADAPTER.loadInitialAssets();
      setPresetImageDir(result.dir);
      setPresetAssets(result.assets);
      setActiveAssetSource(IMAGE_SOURCE_ADAPTER.initialSource);
      setAssetStatus(
        IMAGE_SOURCE_ADAPTER.mode === "local"
          ? "请选择本机图片或文件夹。"
          : result.assets.length ? `已读取 ${result.assets.length} 张服务器示例素材。` : "服务器示例素材目录没有可用图片。",
      );
      setAssetStatusKind("ok");
    } catch (error) {
      setPresetAssets([]);
      setAssetStatus(error instanceof Error ? error.message : "图片读取失败");
      setAssetStatusKind("error");
    }
  }, []);

  const resetWorkspaceForNewAssets = () => {
    setSections(emptySections());
    setReviewImages([]);
    setTranscriptQueue([]);
    setRiskViewActive(false);
    pinnedSectionsRef.current = {};
    setPinnedSections({});
    setTranscriptGenerated(false);
    setPendingRegenerate(false);
    setProblemPackages([]);
    setProblemPackageAnalysis("");
    setProblemPackageValidation(undefined);
    setProblemPackageWarnings([]);
    setSelectedAssetName(null);
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setAssetStatus(`正在上传 ${files.length} 张图片...`);
    setAssetStatusKind("");
    try {
      const result = await IMAGE_SOURCE_ADAPTER.importFiles(files);
      resetWorkspaceForNewAssets();
      setUploadedImageDir(result.dir);
      setUploadedAssets(result.assets);
      setActiveAssetSource("uploaded");
      setAssetStatus(`已上传 ${result.assets.length} 张图片。`);
      setAssetStatusKind("ok");
      setActiveTab("assets");
    } catch (error) {
      setAssetStatus(error instanceof Error ? error.message : "图片上传失败");
      setAssetStatusKind("error");
    }
  };

  const activatePresetAssets = () => {
    resetWorkspaceForNewAssets();
    setActiveAssetSource("preset");
    setAssetStatus(presetAssets.length ? `已切换到 ${presetAssets.length} 张服务器示例素材。` : "服务器示例素材目录没有可用图片。");
    setAssetStatusKind("ok");
  };

  useEffect(() => {
    void loadInitialAssets();
  }, [loadInitialAssets]);

  const buildPayload = useCallback((): GeneratePayload => ({
    title,
    template,
    imageDir,
    sections: orderedSectionDefinitions().map((definition) => ({
      id: definition.id,
      title: definition.title,
      note: sections[definition.id].note,
      assets: sections[definition.id].assets.map(({ name, width, height }) => ({ name, width, height })),
    })),
  }), [imageDir, sections, template, title]);

  const clearProblemPackages = () => {
    setProblemPackages([]);
    setProblemPackageAnalysis("");
    setProblemPackageValidation(undefined);
    setProblemPackageWarnings([]);
  };

  const queueFromImage = (image: ReviewImage): QueueImage => ({
    imageId: image.imageId,
    sectionId: image.sectionId,
    sectionTitle: image.sectionTitle,
    assetName: image.assetName,
    order: image.order,
    contentType: image.contentType || "problem",
    ocrText: image.ocrText,
    corrections: [],
  });

  const imageRefsFromPayload = (payload: GeneratePayload): ImageRef[] => {
    const seen = new Set<string>();
    const refs: ImageRef[] = [];
    for (const section of payload.sections) {
      section.assets.forEach((asset, index) => {
        const ref = { sectionId: section.id, assetName: asset.name, order: index + 1 };
        const key = `${ref.sectionId}:${ref.assetName}:${ref.order}`;
        if (seen.has(key)) return;
        seen.add(key);
        refs.push(ref);
      });
    }
    return refs;
  };

  const placeholderReviewImage = (payload: GeneratePayload, ref: ImageRef, status: ReviewImage["status"]): ReviewImage => {
    const section = payload.sections.find((item) => item.id === ref.sectionId);
    const asset = section?.assets.find((item, index) => item.name === ref.assetName && index + 1 === ref.order);
    return {
      imageId: `${ref.sectionId}:${ref.order - 1}:${ref.assetName}`,
      sectionId: ref.sectionId,
      sectionTitle: section?.title || ref.sectionId,
      assetName: ref.assetName,
      order: ref.order,
      width: asset?.width || 0,
      height: asset?.height || 0,
      ocrText: "",
      riskItems: [],
      summary: status === "queued" ? "等待识别校验。" : "正在识别校验。",
      contentType: "problem",
      status,
    };
  };

  const failedReviewImage = (payload: GeneratePayload, ref: ImageRef, message: string): ReviewImage => ({
    ...placeholderReviewImage(payload, ref, "failed"),
    summary: message,
    riskItems: [{
      id: "analysis-failed",
      field: "其他",
      currentText: "",
      suggestedText: "",
      reason: message,
      severity: "high",
    }],
  });

  const replaceReviewImage = (image: ReviewImage) => {
    setReviewImages((current) => current.map((item) => item.imageId === image.imageId ? image : item));
  };

  const requireTeacherConfirmation = (image: ReviewImage): ReviewImage => (
    image.status === "failed" ? image : { ...image, status: "needs_review" }
  );

  const runAnalyzeTasks = async (payload: GeneratePayload, refs: ImageRef[], concurrency = ANALYZE_FALLBACK_CONCURRENCY) => {
    const results = new Array<ReviewImage>(refs.length);
    let cursor = 0;
    let done = 0;
    const workers = Array.from({ length: Math.min(concurrency, refs.length) }, async () => {
      while (cursor < refs.length) {
        const index = cursor;
        cursor += 1;
        const ref = refs[index];
        const analyzing = placeholderReviewImage(payload, ref, "analyzing");
        replaceReviewImage(analyzing);
        setAnalysisProgress({ phase: "analyzing", total: refs.length, done, current: ref.assetName });
        setTranscriptStatus(`识别校验中 ${done}/${refs.length}：${ref.assetName}`);
        try {
          const image = await analyzeSingleImage(payload, ref);
          const pending = requireTeacherConfirmation(image);
          results[index] = pending;
          replaceReviewImage(pending);
        } catch (error) {
          if (error instanceof Error && error.message.includes("后端服务版本过旧")) throw error;
          const failed = failedReviewImage(payload, ref, error instanceof Error ? error.message : "图片识别失败");
          results[index] = failed;
          replaceReviewImage(failed);
        } finally {
          done += 1;
          setAnalysisProgress({ phase: "analyzing", total: refs.length, done, current: ref.assetName });
          setTranscriptStatus(`识别校验中 ${done}/${refs.length}：${ref.assetName}`);
        }
      }
    });
    await Promise.all(workers);
    return results;
  };

  const finalizeAnalyzedImages = async (images: ReviewImage[], total: number) => {
    setReviewImages(images.map(requireTeacherConfirmation));
    setTranscriptQueue([]);
    setRiskViewActive(true);
    const riskyCount = images.filter((image) => image.status === "needs_review" || image.status === "failed" || image.riskItems.length).length;
    setTranscriptStatus(riskyCount ? `识别完成，${riskyCount} 张图片有风险点，请逐张校验。` : "识别完成，请逐张确认图片类型和 OCR 结果。");
    setTranscriptStatusKind(riskyCount ? "review" : "");
    setAnalysisProgress({ phase: "done", total, done: total });
  };

  const runAnalyzeStream = (payload: GeneratePayload, refs: ImageRef[]) => new Promise<ReviewImage[]>((resolve, reject) => {
    let source: EventSource | null = null;
    startAnalyzeStream(payload).then(({ jobId }) => {
      const images: ReviewImage[] = [];
      source = new EventSource(`/api/analyze-stream/${encodeURIComponent(jobId)}`);
      const close = () => {
        source?.close();
        source = null;
      };
      const handleEvent = (type: AnalyzeStreamEvent["type"]) => (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (type === "job-start") {
          setAnalysisProgress({ phase: "analyzing", total: data.total, done: data.done });
          setTranscriptStatus(`识别校验中 ${data.done}/${data.total}`);
        }
        if (type === "image-start") {
          const ref = { sectionId: data.sectionId, assetName: data.assetName, order: data.order };
          replaceReviewImage(placeholderReviewImage(payload, ref, "analyzing"));
          setAnalysisProgress({ phase: "analyzing", total: data.total, done: data.done, current: data.assetName });
          setTranscriptStatus(`识别校验中 ${data.done}/${data.total}：${data.assetName}`);
        }
        if (type === "image-done" || type === "image-error") {
          const image = requireTeacherConfirmation(data.image as ReviewImage);
          images.push(image);
          replaceReviewImage(image);
          setAnalysisProgress({ phase: "analyzing", total: data.total, done: data.done, current: image.assetName });
          setTranscriptStatus(`识别校验中 ${data.done}/${data.total}：${image.assetName}`);
        }
        if (type === "job-done") {
          close();
          resolve(((data.images || images) as ReviewImage[]).map(requireTeacherConfirmation));
        }
        if (type === "job-error") {
          close();
          reject(new Error(data.error || "SSE 识别任务失败"));
        }
      };

      source.addEventListener("job-start", handleEvent("job-start"));
      source.addEventListener("image-start", handleEvent("image-start"));
      source.addEventListener("image-done", handleEvent("image-done"));
      source.addEventListener("image-error", handleEvent("image-error"));
      source.addEventListener("job-done", handleEvent("job-done"));
      source.addEventListener("job-error", handleEvent("job-error"));
      source.onerror = () => {
        close();
        reject(new Error("SSE 连接失败，已切换为普通识别模式。"));
      };
    }).catch(reject);
  });

  const runAnalyzeWithFallback = async (payload: GeneratePayload, refs: ImageRef[]) => {
    if (typeof EventSource !== "undefined") {
      try {
        return await runAnalyzeStream(payload, refs);
      } catch (error) {
        setTranscriptStatus(error instanceof Error ? error.message : "SSE 连接失败，已切换为普通识别模式。");
      }
    }

    try {
      return await runAnalyzeTasks(payload, refs, 2);
    } catch (error) {
      // Keep this only as a compatibility fallback for older API services that
      // do not expose /api/analyze-image. Normal regeneration paths should only
      // analyze newly added images, never the already confirmed queue.
      if (error instanceof Error && error.message.includes("后端服务版本过旧")) {
        const result = await analyzeImages(payload);
        return result.images || [];
      }
      throw error;
    }
  };

  const addAssetToSection = (sectionId: SectionId, assetName: string) => {
    const asset = assets.find((item) => item.name === assetName);
    if (!asset) return;
    setSections((current) => {
      if (current[sectionId].assets.some((item) => item.name === asset.name)) return current;
      return {
        ...current,
        [sectionId]: { ...current[sectionId], assets: [...current[sectionId].assets, asset] },
      };
    });
  };

  const removeAssetFromSection = (sectionId: SectionId, assetName: string, clearPackages = true) => {
    setSections((current) => ({
      ...current,
      [sectionId]: { ...current[sectionId], assets: current[sectionId].assets.filter((asset) => asset.name !== assetName) },
    }));
    if (clearPackages) clearProblemPackages();
    if (!confirmedAssetKeys.has(assetKey(sectionId, assetName))) {
      setReviewImages((current) => current.filter((image) => !(image.sectionId === sectionId && image.assetName === assetName)));
    }
  };

  const purgeAssetFromQueue = (sectionId: SectionId, assetName: string, clearPackages = true) => {
    setReviewImages((current) => current.filter((image) => !(image.sectionId === sectionId && image.assetName === assetName)));
    setTranscriptQueue((current) => current.filter((image) => !(image.sectionId === sectionId && image.assetName === assetName)));
    if (clearPackages) clearProblemPackages();
  };

  const moveAsset = (sectionId: SectionId, fromIndex: number, toIndex: number) => {
    setSections((current) => {
      const list = [...current[sectionId].assets];
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length || fromIndex === toIndex) return current;
      const [item] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, item);
      return { ...current, [sectionId]: { ...current[sectionId], assets: list } };
    });
  };

  const generateProblemPackagesFromQueue = async (queue: QueueImage[], regenerate = false) => {
    const problemQueue = queue.filter((image) => (image.contentType || "problem") === "problem");
    const explanationContext = queue
      .filter((image) => (image.contentType || "problem") === "explanation")
      .map((image) => image.ocrText)
      .filter(Boolean)
      .join("\n\n");
    if (!problemQueue.length) {
      setProblemPackages([]);
      setProblemPackageAnalysis(queue.map((image) => image.ocrText).join("\n\n"));
      setProblemPackageValidation({ passed: true, checkedCount: 0, repairedCount: 0, items: [], summary: "没有题目图片，已跳过题目包生成。" });
      setProblemPackageWarnings(["当前已确认图片均为讲解素材，已跳过题目包生成。"]);
      await generateTranscriptFromPackages(queue, [], queue.map((image) => image.ocrText).join("\n\n"), regenerate, transcriptGenerated || pendingRegenerate);
      return;
    }
    setGenerating(true);
    setAnalysisProgress((current) => ({ ...current, phase: "generating" }));
    setTranscriptStatus(regenerate ? "正在并行重新生成题目包..." : "正在并行生成题目包...");
    setTranscriptStatusKind("");
    setActiveTab("transcript");
    setRiskViewActive(true);
    try {
      const result = await generateProblemPackages(buildPayload(), problemQueue);
      const mergedAnalysis = [explanationContext ? `# 已确认讲解素材\n\n${explanationContext}` : "", result.analysis || ""].filter(Boolean).join("\n\n");
      setProblemPackages(result.solutions || []);
      setProblemPackageAnalysis(mergedAnalysis);
      setProblemPackageValidation(result.solutionValidation);
      setProblemPackageWarnings(result.solutionWarnings || result.warnings || []);
      setTranscriptStatus(result.solutionValidation?.passed ? "题目包已生成，请校验后生成逐字稿。" : "题目包已生成，请根据提示校验。");
      setTranscriptStatusKind(result.solutionValidation?.passed ? "ok" : "review");
      setAnalysisProgress((current) => ({ ...current, phase: "done" }));
    } catch (error) {
      setTranscriptStatus(error instanceof Error ? error.message : "题目包生成失败");
      setTranscriptStatusKind("error");
      setAnalysisProgress((current) => ({ ...current, phase: "error" }));
    } finally {
      setGenerating(false);
    }
  };

  const generateTranscriptFromPackages = async (queue: QueueImage[], packages: SolutionResult[], analysis: string, regenerate = false, preservePins = false) => {
    setGenerating(true);
    setAnalysisProgress((current) => ({ ...current, phase: "generating" }));
    setTranscriptStatus(regenerate ? "正在基于已确认题目包重新生成逐字稿..." : "正在基于已确认题目包生成逐字稿...");
    setTranscriptStatusKind("");
    setActiveTab("transcript");
    const previousTranscript = transcript;
    try {
      const result = await generateTranscript(
        buildPayload(),
        queue,
        {
          analysis,
          solutions: packages,
          ...(preservePins ? { previousTranscript, pinnedSections: pinnedSectionsRef.current } : {}),
        },
      );
      setTranscript(result.text || "");
      setViewMode("edit");
      setRiskViewActive(false);
      const baseStatus = result.mode === "mock" ? "示例稿已生成" : "AI 已生成";
      const pinWarning = (result.warnings || []).find((message) => message.includes("锁定") && message.includes("缺少"));
      const solutionWarning = result.solutionWarnings?.[0] || (!result.solutionValidation?.passed && result.solutionValidation?.checkedCount ? "题解需复核" : "");
      setTranscriptStatus(
        pinWarning
          ? `${baseStatus} · ${pinWarning}`
          : solutionWarning
            ? `${baseStatus} · ${solutionWarning}`
            : result.usedPinnedSections ? `${baseStatus} · 图钉锁定已应用` : baseStatus,
      );
      setTranscriptStatusKind("ok");
      setAnalysisProgress((current) => ({ ...current, phase: "done" }));
      setTranscriptGenerated(true);
      setPendingRegenerate(false);
    } catch (error) {
      setTranscriptStatus(error instanceof Error ? error.message : "逐字稿生成失败");
      setTranscriptStatusKind("error");
      setRiskViewActive(false);
      setAnalysisProgress((current) => ({ ...current, phase: "error" }));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
    const payload = buildPayload();
    const refs = imageRefsFromPayload(payload);
    if (!refs.length) {
      setActiveTab("transcript");
      setTranscriptStatus("请先把图片放入左侧白板模块。");
      setTranscriptStatusKind("error");
      return;
    }
    setGenerating(true);
    setActiveTab("transcript");
    setAnalysisProgress({ phase: "analyzing", total: refs.length, done: 0 });
    setTranscriptStatus(`识别校验中 0/${refs.length}`);
    setTranscriptStatusKind("");
    setRiskViewActive(true);
    setReviewImages(refs.map((ref) => placeholderReviewImage(payload, ref, "queued")));
    setTranscriptQueue([]);
    clearProblemPackages();
    pinnedSectionsRef.current = {};
    setPinnedSections({});
    setTranscriptGenerated(false);
    setPendingRegenerate(false);
    try {
      const images = await runAnalyzeWithFallback(payload, refs);
      await finalizeAnalyzedImages(images, refs.length);
    } catch (error) {
      setTranscriptStatus(error instanceof Error ? error.message : "识图校验失败");
      setTranscriptStatusKind("error");
      setAnalysisProgress((current) => ({ ...current, phase: "error" }));
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    const payload = buildPayload();
    clearProblemPackages();
    const refs = imageRefsFromPayload(payload);
    if (!refs.length) {
      setActiveTab("transcript");
      setTranscriptStatus("请先把图片放入左侧白板模块。");
      setTranscriptStatusKind("error");
      return;
    }

    const currentRefByKey = new Map(refs.map((ref) => [assetKey(ref.sectionId, ref.assetName), ref]));
    const removedImages = transcriptQueue.filter((image) => !currentRefByKey.has(assetKey(image.sectionId, image.assetName)));
    if (removedImages.length) {
      const removedText = removedImages.map((image) => `- ${image.sectionTitle} / ${image.assetName}`).join("\n");
      const shouldRemove = window.confirm(`以下图片已从白板删除，是否同时从已确认生成队列中移除？\n\n${removedText}`);
      if (!shouldRemove) return;
    }

    const syncedQueue = transcriptQueue
      .filter((image) => currentRefByKey.has(assetKey(image.sectionId, image.assetName)))
      .map((image) => {
        const ref = currentRefByKey.get(assetKey(image.sectionId, image.assetName));
        const section = payload.sections.find((item) => item.id === image.sectionId);
        return {
          ...image,
          sectionTitle: section?.title || image.sectionTitle,
          order: ref?.order || image.order,
        };
      });
    const syncedKeys = new Set(syncedQueue.map((image) => assetKey(image.sectionId, image.assetName)));
    const addedRefs = refs.filter((ref) => !syncedKeys.has(assetKey(ref.sectionId, ref.assetName)));

    setTranscriptQueue(syncedQueue);
    setReviewImages((current) => current.filter((image) => currentRefByKey.has(assetKey(image.sectionId, image.assetName))));
    if (!addedRefs.length) {
      // Fast path: no whiteboard image delta, so reuse the confirmed queue and
      // skip OCR/risk validation entirely.
      clearProblemPackages();
      await generateProblemPackagesFromQueue(syncedQueue, true);
      return;
    }

    setGenerating(true);
    setActiveTab("transcript");
    setRiskViewActive(true);
    setPendingRegenerate(true);
    setAnalysisProgress({ phase: "analyzing", total: addedRefs.length, done: 0 });
    setTranscriptStatus(`发现 ${addedRefs.length} 张新增图片，正在识别校验...`);
    setTranscriptStatusKind("");
    setReviewImages(addedRefs.map((ref) => placeholderReviewImage(payload, ref, "queued")));
    try {
      const images = await runAnalyzeTasks(payload, addedRefs, 2);
      setTranscriptQueue(syncedQueue);
      setReviewImages(images.map(requireTeacherConfirmation));
      const riskyCount = images.filter((image) => image.status === "needs_review" || image.status === "failed" || image.riskItems.length).length;
      setRiskViewActive(true);
      setTranscriptStatus(riskyCount ? `发现 ${riskyCount} 张新增图片有风险点，请逐张校验。` : `发现 ${images.length} 张新增图片，请逐张确认。`);
      setTranscriptStatusKind(riskyCount ? "review" : "");
      setAnalysisProgress({ phase: "done", total: addedRefs.length, done: addedRefs.length });
    } catch (error) {
      setTranscriptStatus(error instanceof Error ? error.message : "新增图片识别失败");
      setTranscriptStatusKind("error");
      setAnalysisProgress((current) => ({ ...current, phase: "error" }));
    } finally {
      setGenerating(false);
    }
  };

  const pendingRiskCount = reviewImages.filter((image) => (
    image.status !== "confirmed" &&
    !transcriptQueue.some((queued) => queued.imageId === image.imageId)
  )).length;
  const hasReviewedRisks = reviewImages.length > 0 || problemPackages.length > 0;
  const canGenerateQueue = pendingRiskCount === 0 && transcriptQueue.length > 0;
  const riskButtonLabel = problemPackages.length
    ? "题目包校验"
    : !hasReviewedRisks ? "识图校验 无待确认" : pendingRiskCount ? `识图校验 ${pendingRiskCount}` : "识图校验 已确认";

  const handleConfirmImage = (image: ReviewImage, corrections: QueueImage["corrections"], correctedOcrText: string, contentType: QueueImage["contentType"] = "problem") => {
    const queued: QueueImage = {
      imageId: image.imageId,
      sectionId: image.sectionId,
      sectionTitle: image.sectionTitle,
      assetName: image.assetName,
      order: image.order,
      contentType,
      ocrText: correctedOcrText,
      corrections,
    };
    setTranscriptQueue((current) => [...current.filter((item) => item.imageId !== image.imageId), queued]);
    setReviewImages((current) => current.map((item) => item.imageId === image.imageId ? { ...item, contentType, ocrText: correctedOcrText, status: "confirmed" } : item));
    clearProblemPackages();
  };

  const handleDeleteRiskImage = (image: ReviewImage) => {
    removeAssetFromSection(image.sectionId, image.assetName);
    purgeAssetFromQueue(image.sectionId, image.assetName);
    clearProblemPackages();
  };

  const handleDeletePackage = (pkg: SolutionResult) => {
    const sectionId = pkg.sectionId;
    const assetName = pkg.assetName || transcriptQueue.find((item) => item.imageId === pkg.imageId)?.assetName || "";
    if (!assetName) {
      setProblemPackages((current) => current.filter((item) => item.problemId !== pkg.problemId));
      setProblemPackageValidation((current) => current ? { ...current, items: current.items?.filter((item) => item.problemId !== pkg.problemId) } : current);
      return;
    }
    removeAssetFromSection(sectionId, assetName, false);
    purgeAssetFromQueue(sectionId, assetName, false);
    setProblemPackages((current) => current.filter((item) => item.problemId !== pkg.problemId && item.assetName !== assetName));
    setProblemPackageValidation((current) => current ? { ...current, items: current.items?.filter((item) => item.problemId !== pkg.problemId) } : current);
  };

  const handleRebuildPackage = async (pkg: SolutionResult, source: SolutionResult["solutionSource"], guidance: string) => {
    const confirmedImage = transcriptQueue.find((item) => (
      (pkg.imageId && item.imageId === pkg.imageId) ||
      (pkg.assetName && item.assetName === pkg.assetName)
    ));
    if (!confirmedImage) throw new Error("未找到该题目包对应的已确认识别内容。");
    const result = await rebuildProblemPackage(buildPayload(), confirmedImage, pkg, source, guidance);
    if (result.warnings?.length) setProblemPackageWarnings((current) => [...current, ...result.warnings!]);
    return result.solution;
  };

  const handleReanalyzeImage = async (image: ReviewImage) => {
    const payload = buildPayload();
    const ref = { sectionId: image.sectionId, assetName: image.assetName, order: image.order };
    replaceReviewImage({ ...image, status: "analyzing", summary: "正在重新识别校验..." });
    setTranscriptStatus(`重新识别中：${image.assetName}`);
    setTranscriptStatusKind("");
    const next = requireTeacherConfirmation(await analyzeSingleImage(payload, ref));
    replaceReviewImage(next);
    setTranscriptQueue((current) => current.filter((item) => item.imageId !== image.imageId));
    clearProblemPackages();
    setTranscriptStatus(next.status === "needs_review" || next.riskItems.length ? "已更新识别结果，请继续确认该图。" : "重新识别完成，请确认该图。");
    setTranscriptStatusKind(next.status === "needs_review" || next.riskItems.length ? "review" : "");
    return next;
  };

  const handleExportMd = () => {
    const blob = new Blob([transcript], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title || "transcript"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    try {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.position = "fixed";
      iframe.style.left = "-10000px";
      iframe.style.top = "0";
      iframe.style.width = "794px";
      iframe.style.height = "1123px";
      iframe.style.border = "0";
      iframe.style.opacity = "0";

      const stylesheetHtml = Array.from(document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'))
        .map((node) => node.outerHTML)
        .join("\n");
      const safeTitle = title || "课堂逐字稿";
      const escapedTitle = escapeHtml(safeTitle);
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      if (!doc) throw new Error("PDF 导出窗口创建失败");
      doc.open();
      doc.write(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapedTitle}</title>
  ${stylesheetHtml}
  <style>
    @page { margin: 18mm 16mm; }
    html, body { width: auto !important; height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
    body { display: block !important; margin: 0; color: #0f1f3d; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .pdf-export-page { display: block; width: auto; max-width: 760px; height: auto; min-height: 0; margin: 0 auto; overflow: visible; break-inside: auto; }
    .pdf-export-title { margin: 0 0 18px; color: #0f1f3d; font-size: 24px; font-weight: 900; line-height: 1.25; }
    .pdf-export-content { display: block; width: auto; height: auto; min-height: 0; overflow: visible; border: 0; border-radius: 0; background: #fff; padding: 0; color: #0f1f3d; font-size: 13px; line-height: 1.72; break-inside: auto; }
    .pdf-export-content h1, .pdf-export-content h2, .pdf-export-content h3 { break-after: avoid; page-break-after: avoid; }
    .pdf-export-content p, .pdf-export-content li { break-inside: avoid; page-break-inside: avoid; }
    .pdf-export-content ul, .pdf-export-content ol { break-inside: auto; page-break-inside: auto; }
    .pdf-export-content .katex-display { overflow: visible; }
    .pdf-export-content svg { max-width: 100%; height: auto; }
    @media print {
      * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .pdf-export-page { max-width: none; height: auto; overflow: visible; }
      .pdf-export-content { height: auto; overflow: visible; }
    }
  </style>
</head>
<body>
  <main class="pdf-export-page">
    <h1 class="pdf-export-title">${escapedTitle}</h1>
    <section class="pdf-export-content">${renderMarkdownPreview(transcript)}</section>
  </main>
</body>
</html>`);
      doc.close();
      window.setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        window.setTimeout(() => iframe.remove(), 1000);
      }, 100);
    } catch (error) {
      setTranscriptStatus(error instanceof Error ? error.message : "PDF 导出失败");
      setTranscriptStatusKind("error");
    }
  };

  const workspaceLocked = generating || analysisProgress.phase === "analyzing" || analysisProgress.phase === "generating";

  return (
    <main className="app">
      <Whiteboard
        title={title}
        template={template}
        sections={SECTION_DEFINITIONS}
        sectionState={sections}
        selectedAssetName={selectedAssetName}
        confirmedAssetKeys={confirmedAssetKeys}
        pinsVisible={transcriptGenerated}
        pinnedSections={pinnedSections}
        locked={workspaceLocked}
        onTitleChange={setTitle}
        onTemplateChange={setTemplate}
        onGenerate={handleGenerate}
        onAddAsset={addAssetToSection}
        onRemoveAsset={removeAssetFromSection}
        onMoveAsset={moveAsset}
        onNoteChange={(sectionId, value) => setSections((current) => ({ ...current, [sectionId]: { ...current[sectionId], note: value } }))}
        onTogglePin={(key) => setPinnedSections((current) => {
          const next = { ...current, [key]: !current[key] };
          pinnedSectionsRef.current = next;
          return next;
        })}
      />

      <aside className="side-panel" aria-label="右侧工具栏">
        <div className="tab-bar">
          <button className={`tab-button ${activeTab === "assets" ? "active" : ""}`} type="button" onClick={() => setActiveTab("assets")}>
            图片素材 <span className="tab-badge">{assets.length}</span>
          </button>
          <button className={`tab-button ${activeTab === "transcript" ? "active" : ""}`} type="button" onClick={() => setActiveTab("transcript")}>
            逐字稿 <span className="tab-badge">{pendingRiskCount ? `${pendingRiskCount}` : transcript ? "已生成" : "待生成"}</span>
          </button>
        </div>

        <div className="tab-content">
          {activeTab === "assets" ? (
            <AssetPanel
              mode={IMAGE_SOURCE_ADAPTER.mode}
              sourceLabel={sourceLabel}
              assets={assets}
              selectedAssetName={selectedAssetName}
              usedAssetNames={usedAssetNames}
              status={assetStatus}
              statusKind={assetStatusKind}
              locked={workspaceLocked}
              onReloadPresetAssets={IMAGE_SOURCE_ADAPTER.supportsPresetAssets ? activatePresetAssets : undefined}
              onUploadFiles={uploadFiles}
              onUploadError={(message) => {
                setAssetStatus(message);
                setAssetStatusKind("error");
              }}
              onSelectAsset={(assetName) => setSelectedAssetName((current) => current === assetName ? null : assetName)}
              onClearBoard={() => {
                resetWorkspaceForNewAssets();
              }}
            />
          ) : (
            <TranscriptPanel
              transcript={transcript}
              viewMode={viewMode}
              status={transcriptStatus}
              statusKind={transcriptStatusKind}
              riskButtonLabel={riskButtonLabel}
              riskButtonDisabled={!hasReviewedRisks}
              riskViewActive={riskViewActive}
              reviewImages={reviewImages}
              assets={assets}
              queue={transcriptQueue}
              packages={problemPackages}
              packageValidation={problemPackageValidation}
              packageWarnings={problemPackageWarnings}
              progress={analysisProgress}
              canGenerateQueue={canGenerateQueue}
              canRegenerate={canGenerateQueue && transcriptGenerated}
              generating={generating}
              onTranscriptChange={setTranscript}
              onViewModeChange={setViewMode}
              onToggleRiskView={() => setRiskViewActive((current) => !current)}
              onLoadSample={() => {
                setTranscript(sampleTranscript());
                setViewMode("preview");
                setTranscriptStatus("示例稿已载入");
                setTranscriptStatusKind("ok");
              }}
              onExportMd={handleExportMd}
              onExportPdf={handleExportPdf}
              onConfirmImage={handleConfirmImage}
              onDeleteImage={handleDeleteRiskImage}
              onReanalyzeImage={handleReanalyzeImage}
              onPackagesChange={setProblemPackages}
              onDeletePackage={handleDeletePackage}
              onRebuildPackage={handleRebuildPackage}
              onGeneratePackages={() => generateProblemPackagesFromQueue(transcriptQueue, pendingRegenerate)}
              onRegeneratePackages={() => generateProblemPackagesFromQueue(transcriptQueue, true)}
              onGenerateTranscript={() => generateTranscriptFromPackages(transcriptQueue, problemPackages, problemPackageAnalysis, pendingRegenerate, transcriptGenerated || pendingRegenerate)}
              onRegenerate={handleRegenerate}
            />
          )}
        </div>
      </aside>
    </main>
  );
}
