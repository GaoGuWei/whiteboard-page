import type React from "react";
import type { Asset, PinKey, SectionDefinition, SectionId, SectionsState } from "../lib/types";

interface WhiteboardProps {
  title: string;
  template: string;
  sections: SectionDefinition[];
  sectionState: SectionsState;
  selectedAssetName: string | null;
  confirmedAssetKeys: Set<string>;
  pinsVisible: boolean;
  pinnedSections: Partial<Record<PinKey, boolean>>;
  onTitleChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onGenerate: () => void;
  onAddAsset: (sectionId: SectionId, assetName: string) => void;
  onRemoveAsset: (sectionId: SectionId, assetName: string) => void;
  onMoveAsset: (sectionId: SectionId, fromIndex: number, toIndex: number) => void;
  onNoteChange: (sectionId: SectionId, value: string) => void;
  onTogglePin: (key: PinKey) => void;
}

function iconFor(sectionId: SectionId) {
  const icons = {
    review: '<path d="M19 12h26a4 4 0 0 1 4 4v26" /><path d="M17 12a4 4 0 0 0-4 4v32a4 4 0 0 0 4 4h24" /><path d="M23 24h20M23 34h17M23 44h10" /><circle cx="47" cy="47" r="8" />',
    interest: '<path d="m32 10 6.2 13 14.3 2-10.4 10.1 2.5 14.2L32 42.6 19.4 49.3l2.5-14.2L11.5 25l14.3-2L32 10Z" />',
    mindmap: '<rect x="24" y="10" width="16" height="12" rx="3" /><rect x="9" y="40" width="16" height="12" rx="3" /><rect x="39" y="40" width="16" height="12" rx="3" /><path d="M32 22v10M17 40v-7h30v7" />',
    knowledge: '<path d="M12 16c9 0 16 2 20 8 4-6 11-8 20-8v35c-9 0-16 2-20 8-4-6-11-8-20-8V16Z" /><path d="M32 24v35" />',
    test: '<rect x="19" y="13" width="26" height="40" rx="4" /><path d="M27 13c0-2 2-4 5-4s5 2 5 4M25 27h14M25 36h14M25 45h10" />',
  };
  return icons[sectionId];
}

function PinIcon() {
  return (
    <svg className="pin-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 4.5h7" />
      <path d="M10 4.5v5.2L7.5 12h9L14 9.7V4.5" />
      <path d="M12 12v6.5" />
      <path d="m10.5 18.5 1.5 1.5 1.5-1.5" />
    </svg>
  );
}

export function Whiteboard({
  title,
  template,
  sections,
  sectionState,
  selectedAssetName,
  confirmedAssetKeys,
  pinsVisible,
  pinnedSections,
  onTitleChange,
  onTemplateChange,
  onGenerate,
  onAddAsset,
  onRemoveAsset,
  onMoveAsset,
  onNoteChange,
  onTogglePin,
}: WhiteboardProps) {
  const handleDrop = (event: React.DragEvent<HTMLElement>, sectionId: SectionId) => {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    if (event.dataTransfer.getData("application/x-board-asset")) return;
    const assetName = event.dataTransfer.getData("text/plain");
    if (assetName) onAddAsset(sectionId, assetName);
  };

  const handleCardDrop = (event: React.DragEvent<HTMLDivElement>, sectionId: SectionId, targetIndex: number) => {
    const payload = event.dataTransfer.getData("application/x-board-asset");
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove("drop-target");
    try {
      const source = JSON.parse(payload) as { sectionId: SectionId; index: number };
      if (source.sectionId !== sectionId) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const horizontalBias = Math.abs(event.clientX - (rect.left + rect.width / 2));
      const verticalBias = Math.abs(event.clientY - (rect.top + rect.height / 2));
      const insertAfter =
        horizontalBias > verticalBias
          ? event.clientX > rect.left + rect.width / 2
          : event.clientY > rect.top + rect.height / 2;
      const insertIndex = targetIndex + (insertAfter ? 1 : 0);
      const finalIndex = source.index < insertIndex ? insertIndex - 1 : insertIndex;
      onMoveAsset(sectionId, source.index, finalIndex);
    } catch {
      // Ignore malformed drag payloads.
    }
  };

  return (
    <section className="whiteboard" aria-label="白板内容编排区">
      <header className="title-card">
        <button
          className={`pin-button title-pin ${pinnedSections.title ? "pinned" : ""}`}
          type="button"
          disabled={!pinsVisible}
          aria-label={pinnedSections.title ? "取消锁定标题模块" : "锁定标题模块"}
          title={pinnedSections.title ? "取消锁定标题模块" : "锁定标题模块"}
          onClick={() => onTogglePin("title")}
        >
          <PinIcon />
        </button>
        <input className="lesson-title" value={title} onChange={(event) => onTitleChange(event.target.value)} aria-label="课程标题" />
        <select className="template-select" value={template} onChange={(event) => onTemplateChange(event.target.value)}>
          <option value="new">新授课</option>
          <option value="exercise">习题讲评</option>
          <option value="review">复习课</option>
          <option value="open">公开课</option>
        </select>
        <button className="primary-btn" type="button" onClick={onGenerate}>生成逐字稿</button>
      </header>

      <div className="board-grid">
        {sections.map((section) => {
          const data = sectionState[section.id];
          return (
            <article
              key={section.id}
              className={`board-section ${section.wide ? "section-knowledge" : ""}`}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest(".remove-asset") || (event.target as HTMLElement).closest(".section-note") || (event.target as HTMLElement).closest(".pin-button")) return;
                if (selectedAssetName) onAddAsset(section.id, selectedAssetName);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.currentTarget.classList.add("drag-over");
              }}
              onDragLeave={(event) => event.currentTarget.classList.remove("drag-over")}
              onDrop={(event) => handleDrop(event, section.id)}
            >
              <button
                className={`pin-button section-pin ${pinnedSections[section.id] ? "pinned" : ""}`}
                type="button"
                disabled={!pinsVisible}
                aria-label={pinnedSections[section.id] ? `取消锁定${section.title}` : `锁定${section.title}`}
                title={pinnedSections[section.id] ? `取消锁定${section.title}` : `锁定${section.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin(section.id);
                }}
              >
                <PinIcon />
              </button>
              <h2 className="section-title">{section.title}</h2>
              <div className="drop-zone">
                {data.assets.length ? (
                  <div className="assigned-list">
                    {data.assets.map((asset: Asset, index) => (
                      <div
                        className="assigned-card"
                        draggable
                        data-section-id={section.id}
                        data-index={index}
                        key={`${section.id}-${asset.name}`}
                        onDragStart={(event) => {
                          event.currentTarget.classList.add("dragging");
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("application/x-board-asset", JSON.stringify({ sectionId: section.id, index }));
                        }}
                        onDragOver={(event) => {
                          if (!Array.from(event.dataTransfer.types).includes("application/x-board-asset")) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.currentTarget.classList.add("drop-target");
                        }}
                        onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")}
                        onDrop={(event) => handleCardDrop(event, section.id, index)}
                        onDragEnd={(event) => {
                          event.currentTarget.classList.remove("dragging");
                          event.currentTarget.parentElement?.querySelectorAll(".drop-target").forEach((target) => target.classList.remove("drop-target"));
                        }}
                      >
                        <img src={asset.url} alt={asset.name} />
                        <span className="order-pill">第 {index + 1} 张</span>
                        {confirmedAssetKeys.has(`${section.id}:${asset.name}`) ? <span className="confirmed-pill">已确认</span> : null}
                        <button className="remove-asset" type="button" onClick={(event) => { event.stopPropagation(); onRemoveAsset(section.id, asset.name); }} aria-label={`移除 ${asset.name}`}>×</button>
                        <div className="assigned-footer">
                          <span className="assigned-name">{asset.name}</span>
                          <div className="asset-order-actions" aria-label={`${asset.name} 排序`}>
                            <button className="order-btn" type="button" disabled={index === 0} onClick={(event) => { event.stopPropagation(); onMoveAsset(section.id, index, index - 1); }}>↑</button>
                            <button className="order-btn" type="button" disabled={index === data.assets.length - 1} onClick={(event) => { event.stopPropagation(); onMoveAsset(section.id, index, index + 1); }}>↓</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <svg viewBox="0 0 64 64" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconFor(section.id) }} />
                    <span>{section.hint}</span>
                  </div>
                )}
              </div>
              <textarea className="section-note" placeholder="填写本环节教学目标或提示..." value={data.note} onChange={(event) => onNoteChange(section.id, event.target.value)} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
