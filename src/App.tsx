import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Whiteboard } from "./components/Whiteboard";
import { AssetPanel } from "./components/side/AssetPanel";
import { TranscriptPanel } from "./components/side/TranscriptPanel";
import { analyzeImages, analyzeSingleImage, exportDocx, generateTranscript, listAssets, selectFolder, startAnalyzeStream } from "./lib/api";
import type { AnalysisProgress, AnalyzeStreamEvent, Asset, GeneratePayload, ImageRef, PinKey, QueueImage, ReviewImage, SectionDefinition, SectionId, SectionsState } from "./lib/types";

const DEFAULT_IMAGE_DIR = "/Users/gao/Pictures/逐字稿test/因式分解";

const SECTION_DEFINITIONS: SectionDefinition[] = [
  { id: "review", title: "一、复习检测", hint: "在此处放入复习题或检测截图" },
  { id: "interest", title: "二、兴趣构建", hint: "在此处放入情境、问题或知识点截图" },
  { id: "mindmap", title: "四、思维导图", hint: "在此处放入思维导图或结构截图" },
  { id: "knowledge", title: "三、知识讲解", hint: "在此处放入例题、公式或知识点截图", wide: true },
  { id: "test", title: "五、效果检测", hint: "在此处放入课堂练习或检测题截图" },
];
const TRANSCRIPT_SECTION_ORDER: SectionId[] = ["review", "interest", "knowledge", "mindmap", "test"];

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
    "### 板书/展示提示",
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
  const [imageDir, setImageDir] = useState(DEFAULT_IMAGE_DIR);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetStatus, setAssetStatus] = useState("准备读取图片素材。");
  const [assetStatusKind, setAssetStatusKind] = useState<"ok" | "error" | "">("");
  const [selectedAssetName, setSelectedAssetName] = useState<string | null>(null);
  const [title, setTitle] = useState("标题");
  const [template, setTemplate] = useState("new");
  const [sections, setSections] = useState<SectionsState>(() => emptySections());
  const [transcript, setTranscript] = useState("");
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [transcriptStatus, setTranscriptStatus] = useState("待生成");
  const [transcriptStatusKind, setTranscriptStatusKind] = useState<"ok" | "error" | "">("");
  const [reviewImages, setReviewImages] = useState<ReviewImage[]>([]);
  const [transcriptQueue, setTranscriptQueue] = useState<QueueImage[]>([]);
  const [riskViewActive, setRiskViewActive] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>({ phase: "idle", total: 0, done: 0 });
  const [transcriptGenerated, setTranscriptGenerated] = useState(false);
  const [pinnedSections, setPinnedSections] = useState<Partial<Record<PinKey, boolean>>>({});
  const pinnedSectionsRef = useRef<Partial<Record<PinKey, boolean>>>({});
  const [pendingRegenerate, setPendingRegenerate] = useState(false);

  const usedAssetNames = useMemo(() => {
    const names = new Set<string>();
    for (const section of Object.values(sections)) for (const asset of section.assets) names.add(asset.name);
    return names;
  }, [sections]);
  const confirmedAssetKeys = useMemo(() => new Set(transcriptQueue.map((image) => assetKey(image.sectionId, image.assetName))), [transcriptQueue]);

  const loadAssets = useCallback(async (dir = imageDir) => {
    setAssetStatus("正在读取图片...");
    setAssetStatusKind("");
    try {
      const result = await listAssets(dir);
      setImageDir(result.dir);
      setAssets(result.assets);
      setAssetStatus(result.assets.length ? `已读取 ${result.assets.length} 张图片。` : "当前文件夹没有可用图片。");
      setAssetStatusKind("ok");
    } catch (error) {
      setAssets([]);
      setAssetStatus(error instanceof Error ? error.message : "图片读取失败");
      setAssetStatusKind("error");
    }
  }, [imageDir]);

  useEffect(() => {
    void loadAssets(DEFAULT_IMAGE_DIR);
  }, []);

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

  const queueFromImage = (image: ReviewImage): QueueImage => ({
    imageId: image.imageId,
    sectionId: image.sectionId,
    sectionTitle: image.sectionTitle,
    assetName: image.assetName,
    order: image.order,
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

  const runAnalyzeTasks = async (payload: GeneratePayload, refs: ImageRef[], concurrency = 2) => {
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
          results[index] = image;
          replaceReviewImage(image);
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
    const riskyImages = images.filter((image) => image.status === "needs_review" || image.status === "failed" || image.riskItems.length);
    const autoQueue = images.filter((image) => !riskyImages.includes(image)).map(queueFromImage);
    setReviewImages(riskyImages);
    setTranscriptQueue(autoQueue);
    if (riskyImages.length) {
      setRiskViewActive(true);
      setTranscriptStatus(`发现 ${riskyImages.length} 张风险图片，请先校验。`);
      setTranscriptStatusKind("error");
      setAnalysisProgress({ phase: "done", total, done: total });
      return;
    }

    setTranscriptStatus("识图通过，正在生成逐字稿...");
    setTranscriptStatusKind("");
    await generateFromQueue(autoQueue);
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
          const image = data.image as ReviewImage;
          images.push(image);
          replaceReviewImage(image);
          setAnalysisProgress({ phase: "analyzing", total: data.total, done: data.done, current: image.assetName });
          setTranscriptStatus(`识别校验中 ${data.done}/${data.total}：${image.assetName}`);
        }
        if (type === "job-done") {
          close();
          resolve((data.images || images) as ReviewImage[]);
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

  const removeAssetFromSection = (sectionId: SectionId, assetName: string) => {
    setSections((current) => ({
      ...current,
      [sectionId]: { ...current[sectionId], assets: current[sectionId].assets.filter((asset) => asset.name !== assetName) },
    }));
    if (!confirmedAssetKeys.has(assetKey(sectionId, assetName))) {
      setReviewImages((current) => current.filter((image) => !(image.sectionId === sectionId && image.assetName === assetName)));
    }
  };

  const purgeAssetFromQueue = (sectionId: SectionId, assetName: string) => {
    setReviewImages((current) => current.filter((image) => !(image.sectionId === sectionId && image.assetName === assetName)));
    setTranscriptQueue((current) => current.filter((image) => !(image.sectionId === sectionId && image.assetName === assetName)));
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

  const generateFromQueue = async (queue: QueueImage[], regenerate = false, preservePins = false) => {
    setGenerating(true);
    setAnalysisProgress((current) => ({ ...current, phase: "generating" }));
    setTranscriptStatus(regenerate ? "正在基于已确认图片队列重新生成逐字稿..." : "正在整合分析并生成逐字稿...");
    setTranscriptStatusKind("");
    setActiveTab("transcript");
    const previousTranscript = transcript;
    try {
      const result = await generateTranscript(
        buildPayload(),
        queue,
        preservePins ? { previousTranscript, pinnedSections: pinnedSectionsRef.current } : {},
      );
      setTranscript(result.text || "");
      setViewMode("edit");
      setRiskViewActive(false);
      const baseStatus = result.mode === "mock" ? "示例稿已生成" : "AI 已生成";
      const pinWarning = (result.warnings || []).find((message) => message.includes("锁定") && message.includes("缺少"));
      setTranscriptStatus(pinWarning ? `${baseStatus} · ${pinWarning}` : result.usedPinnedSections ? `${baseStatus} · 图钉锁定已应用` : baseStatus);
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
      await generateFromQueue(syncedQueue, true, transcriptGenerated);
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
      const riskyImages = images.filter((image) => image.status === "needs_review" || image.status === "failed" || image.riskItems.length);
      const autoQueue = images.filter((image) => !riskyImages.includes(image)).map(queueFromImage);
      const nextQueue = [...syncedQueue, ...autoQueue];
      setTranscriptQueue(nextQueue);
      setReviewImages(riskyImages);
      if (riskyImages.length) {
        setRiskViewActive(true);
        setTranscriptStatus(`发现 ${riskyImages.length} 张新增风险图片，请先校验。`);
        setTranscriptStatusKind("error");
        setAnalysisProgress({ phase: "done", total: addedRefs.length, done: addedRefs.length });
        return;
      }
      setRiskViewActive(false);
      await generateFromQueue(nextQueue, true, transcriptGenerated);
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
  const hasReviewedRisks = reviewImages.length > 0;
  const canGenerateQueue = pendingRiskCount === 0 && transcriptQueue.length > 0;
  const riskButtonLabel = !hasReviewedRisks ? "风险校验 无风险" : pendingRiskCount ? `风险校验 ${pendingRiskCount}` : "风险校验 已确认";

  const handleConfirmImage = (image: ReviewImage, corrections: QueueImage["corrections"], correctedOcrText: string) => {
    const queued: QueueImage = {
      imageId: image.imageId,
      sectionId: image.sectionId,
      sectionTitle: image.sectionTitle,
      assetName: image.assetName,
      order: image.order,
      ocrText: correctedOcrText,
      corrections,
    };
    setTranscriptQueue((current) => [...current.filter((item) => item.imageId !== image.imageId), queued]);
    setReviewImages((current) => current.map((item) => item.imageId === image.imageId ? { ...item, status: "confirmed" } : item));
  };

  const handleDeleteRiskImage = (image: ReviewImage) => {
    removeAssetFromSection(image.sectionId, image.assetName);
    purgeAssetFromQueue(image.sectionId, image.assetName);
  };

  const handleReanalyzeImage = async (image: ReviewImage) => {
    const payload = buildPayload();
    const ref = { sectionId: image.sectionId, assetName: image.assetName, order: image.order };
    replaceReviewImage({ ...image, status: "analyzing", summary: "正在重新识别校验..." });
    setTranscriptStatus(`重新识别中：${image.assetName}`);
    setTranscriptStatusKind("");
    const next = await analyzeSingleImage(payload, ref);
    replaceReviewImage(next);
    setTranscriptQueue((current) => current.filter((item) => item.imageId !== image.imageId));
    if (next.status === "confirmed" && !next.riskItems.length) {
      setTranscriptQueue((current) => [...current.filter((item) => item.imageId !== next.imageId), queueFromImage(next)]);
    }
    setTranscriptStatus(next.status === "needs_review" ? "已更新风险识别结果。" : "重新识别完成，该图无需风险确认。");
    setTranscriptStatusKind(next.status === "needs_review" ? "error" : "ok");
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

  const handleExportWord = async () => {
    try {
      const blob = await exportDocx(title, transcript);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title || "transcript"}.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setTranscriptStatus(error instanceof Error ? error.message : "Word 导出失败");
      setTranscriptStatusKind("error");
    }
  };

  const handleSelectFolder = async () => {
    try {
      setAssetStatus("正在打开文件夹选择窗口...");
      const result = await selectFolder(imageDir);
      await loadAssets(result.dir);
    } catch (error) {
      setAssetStatus(error instanceof Error ? error.message : "选择文件夹失败");
      setAssetStatusKind("error");
    }
  };

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
              dir={imageDir}
              assets={assets}
              selectedAssetName={selectedAssetName}
              usedAssetNames={usedAssetNames}
              status={assetStatus}
              statusKind={assetStatusKind}
              onDirChange={setImageDir}
              onRead={() => loadAssets(imageDir)}
              onSelectFolder={handleSelectFolder}
              onSelectAsset={(assetName) => setSelectedAssetName((current) => current === assetName ? null : assetName)}
              onClearBoard={() => {
                setSections(emptySections());
                setReviewImages([]);
                setTranscriptQueue([]);
                setRiskViewActive(false);
                pinnedSectionsRef.current = {};
                setPinnedSections({});
                setTranscriptGenerated(false);
                setPendingRegenerate(false);
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
              onExportWord={handleExportWord}
              onConfirmImage={handleConfirmImage}
              onDeleteImage={handleDeleteRiskImage}
              onReanalyzeImage={handleReanalyzeImage}
              onGenerateQueue={() => generateFromQueue(transcriptQueue, pendingRegenerate, transcriptGenerated || pendingRegenerate)}
              onRegenerate={handleRegenerate}
            />
          )}
        </div>
      </aside>
    </main>
  );
}
