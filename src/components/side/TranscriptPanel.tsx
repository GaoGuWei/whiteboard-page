import type { AnalysisProgress, Asset, QueueImage, ReviewImage } from "../../lib/types";
import { renderMarkdownPreview } from "../../lib/markdown";
import { RiskValidation } from "./RiskValidation";

const SPEECH_CHARS_PER_MINUTE = 260;

function estimateSpeechMinutes(markdown: string) {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/gi, "").replace(/```/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)、]\s+/gm, "")
    .replace(/[*_`~>\[\]()]|!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, "");
  const charCount = Array.from(cleaned).length;
  if (!charCount) return 0;
  return Math.max(1, Math.round(charCount / SPEECH_CHARS_PER_MINUTE));
}

interface TranscriptPanelProps {
  transcript: string;
  viewMode: "edit" | "preview";
  status: string;
  statusKind: "ok" | "error" | "";
  riskButtonLabel: string;
  riskButtonDisabled: boolean;
  riskViewActive: boolean;
  reviewImages: ReviewImage[];
  assets: Asset[];
  queue: QueueImage[];
  progress: AnalysisProgress;
  canGenerateQueue: boolean;
  canRegenerate: boolean;
  generating: boolean;
  onTranscriptChange: (value: string) => void;
  onViewModeChange: (mode: "edit" | "preview") => void;
  onToggleRiskView: () => void;
  onLoadSample: () => void;
  onExportMd: () => void;
  onExportWord: () => void;
  onConfirmImage: (image: ReviewImage, corrections: QueueImage["corrections"], correctedOcrText: string) => void;
  onDeleteImage: (image: ReviewImage) => void;
  onReanalyzeImage: (image: ReviewImage) => Promise<ReviewImage | void>;
  onGenerateQueue: () => void;
  onRegenerate: () => void;
}

export function TranscriptPanel({
  transcript,
  viewMode,
  status,
  statusKind,
  riskButtonLabel,
  riskButtonDisabled,
  riskViewActive,
  reviewImages,
  assets,
  queue,
  progress,
  canGenerateQueue,
  canRegenerate,
  generating,
  onTranscriptChange,
  onViewModeChange,
  onToggleRiskView,
  onLoadSample,
  onExportMd,
  onExportWord,
  onConfirmImage,
  onDeleteImage,
  onReanalyzeImage,
  onGenerateQueue,
  onRegenerate,
}: TranscriptPanelProps) {
  const shouldShowDuration = statusKind === "ok" && Boolean(transcript.trim()) && !riskViewActive && progress.phase !== "generating";
  const speechMinutes = shouldShowDuration ? estimateSpeechMinutes(transcript) : 0;

  return (
    <section className="tab-pane active transcript-panel active" aria-label="逐字稿">
      <div className="transcript-head">
        <h2 className="transcript-title">逐字稿</h2>
        <span className={`status status-group ${statusKind}`}>
          <span>{status}</span>
          {speechMinutes ? <span className="speech-duration">约 {speechMinutes} 分钟</span> : null}
        </span>
      </div>

      <div className="transcript-actions">
        <div className="view-toggle" aria-label="逐字稿视图切换">
          <button className={`view-btn ${viewMode === "edit" ? "active" : ""}`} type="button" onClick={() => onViewModeChange("edit")} disabled={riskViewActive}>编辑</button>
          <button className={`view-btn ${viewMode === "preview" ? "active" : ""}`} type="button" onClick={() => onViewModeChange("preview")} disabled={riskViewActive}>预览</button>
        </div>
        <button className={`ghost-btn ${riskViewActive ? "active" : ""}`} type="button" disabled={riskButtonDisabled} onClick={onToggleRiskView}>
          {riskButtonLabel}
        </button>
        <button className="ghost-btn" type="button" onClick={onRegenerate} disabled={!canRegenerate || generating || riskViewActive}>
          {generating && canRegenerate && !riskViewActive ? "重新生成中..." : "重新生成"}
        </button>
        <button className="ghost-btn" type="button" onClick={onExportMd} disabled={!transcript || riskViewActive}>导出 MD</button>
        <button className="ghost-btn" type="button" onClick={onExportWord} disabled={!transcript || riskViewActive}>导出 Word</button>
        <button className="ghost-btn" type="button" onClick={onLoadSample} disabled={riskViewActive}>示例稿</button>
      </div>

      {riskViewActive ? (
        <RiskValidation
          images={reviewImages}
          assets={assets}
          queue={queue}
          progress={progress}
          canGenerate={canGenerateQueue}
          generating={generating}
          onConfirmImage={onConfirmImage}
          onDeleteImage={onDeleteImage}
          onReanalyzeImage={onReanalyzeImage}
          onGenerateQueue={onGenerateQueue}
        />
      ) : (
        <>
          <textarea
            className="transcript-editor"
            hidden={viewMode !== "edit"}
            value={transcript}
            onChange={(event) => onTranscriptChange(event.target.value)}
            placeholder="生成后的逐字稿会显示在这里，可以直接编辑。"
          />
          <div
            className="transcript-preview"
            hidden={viewMode !== "preview"}
            dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(transcript) }}
          />
        </>
      )}
    </section>
  );
}
