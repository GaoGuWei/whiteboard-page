import { useEffect, useMemo, useState } from "react";
import { renderMarkdownPreviewWithWarnings } from "../../lib/markdown";
import type { AnalysisProgress, Asset, QueueImage, ReviewImage } from "../../lib/types";

interface RiskValidationProps {
  images: ReviewImage[];
  assets: Asset[];
  queue: QueueImage[];
  progress: AnalysisProgress;
  onConfirmImage: (image: ReviewImage, corrections: QueueImage["corrections"], correctedOcrText: string) => void;
  onDeleteImage: (image: ReviewImage) => void;
  onReanalyzeImage: (image: ReviewImage) => Promise<ReviewImage | void>;
  onGenerateQueue: () => void;
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
  onGenerateQueue,
  canGenerate,
  generating,
}: RiskValidationProps) {
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const activeImage = useMemo(() => images.find((image) => image.imageId === activeImageId) || null, [activeImageId, images]);
  const [ocrDraft, setOcrDraft] = useState("");
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);
  const [modalError, setModalError] = useState("");
  const queuedIds = useMemo(() => new Set(queue.map((item) => item.imageId)), [queue]);
  const ocrPreview = useMemo(() => renderMarkdownPreviewWithWarnings(ocrDraft), [ocrDraft]);

  useEffect(() => {
    if (!activeImage) return;
    setOcrDraft(activeImage.ocrText || "");
    setModalError("");
  }, [activeImage]);

  const assetUrl = (assetName: string) => assets.find((asset) => asset.name === assetName)?.url || "";
  const pendingCount = images.filter((image) => image.status !== "confirmed" && !queuedIds.has(image.imageId)).length;
  const progressPercent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const statusText = (image: ReviewImage) => {
    if (queuedIds.has(image.imageId) || image.status === "confirmed") return "已确认";
    if (image.status === "queued") return "等待中";
    if (image.status === "analyzing") return "识别中";
    if (image.status === "failed") return "识别失败";
    return "需确认";
  };

  return (
    <>
      <section className="review-panel" aria-label="风险校验列表">
        <div className="review-head">
          <div>
            <h3 className="review-title">风险校验</h3>
            <p className="review-summary">
              {progress.phase === "analyzing"
                ? `识别校验中 ${progress.done}/${progress.total}${progress.current ? `：${progress.current}` : ""}`
                : pendingCount ? `还有 ${pendingCount} 张图片需要确认。` : "风险图片已处理，可以生成已确认队列。"}
            </p>
          </div>
          <button className="primary-btn" type="button" disabled={!canGenerate || generating} onClick={onGenerateQueue}>
            {generating ? "生成中..." : "生成已确认队列"}
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
                    <div className="review-card-sub">{image.sectionTitle} · 第 {image.order} 张 · {statusText(image)}{image.riskItems.length ? ` · ${image.riskItems.length} 个风险点` : ""}</div>
                  </div>
                </div>
                <p className="review-summary">{image.summary || "需要人工确认识图结果。"}</p>
                <div className="review-card-actions">
                  <button className="tiny-btn" type="button" disabled={confirmed || image.status === "queued" || image.status === "analyzing"} onClick={() => setActiveImageId(image.imageId)}>编辑</button>
                  <button className="tiny-btn" type="button" onClick={() => onDeleteImage(image)}>删除</button>
                </div>
              </article>
            );
          }) : (
            <p className="review-summary">暂无风险图片。</p>
          )}
        </div>
      </section>

      <div className="risk-modal" hidden={!activeImage}>
        {activeImage ? (
          <div className="risk-dialog" role="dialog" aria-modal="true" aria-label="风险点编辑">
            <div className="risk-dialog-head">
              <h3 className="risk-dialog-title">编辑风险点</h3>
              <button className="tiny-btn" type="button" onClick={() => setActiveImageId(null)}>关闭</button>
            </div>
            <div className="risk-dialog-body">
              <div className="risk-dialog-meta">
                <div className="risk-image-card">
                  <div className="risk-image-info">
                    <span>{activeImage.sectionTitle} · 第 {activeImage.order} 张</span>
                    <strong>{activeImage.assetName}</strong>
                  </div>
                  <img className="risk-dialog-thumb" src={assetUrl(activeImage.assetName)} alt={activeImage.assetName} />
                </div>
                <div className="risk-ocr-pane">
                  <textarea
                    className="ocr-editor"
                    value={ocrDraft}
                    onChange={(event) => setOcrDraft(event.target.value)}
                    aria-label="可编辑识图文本"
                  />
                </div>
              </div>

              <div className="risk-dialog-bottom">
                {modalError ? <p className="status error risk-modal-error">{modalError}</p> : null}
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
                disabled={reanalyzingId === activeImage.imageId}
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
                disabled={reanalyzingId === activeImage.imageId}
                onClick={() => {
                  onConfirmImage(activeImage, [], ocrDraft);
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
