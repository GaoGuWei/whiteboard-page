import { useRef } from "react";
import type { AppMode, ImageAsset } from "../../lib/types";

interface AssetPanelProps {
  mode: AppMode;
  sourceLabel: string;
  assets: ImageAsset[];
  selectedAssetName: string | null;
  usedAssetNames: Set<string>;
  status: string;
  statusKind: "ok" | "error" | "";
  locked?: boolean;
  onReloadPresetAssets?: () => void;
  onUploadFiles: (files: File[]) => void;
  onUploadError: (message: string) => void;
  onSelectAsset: (assetName: string) => void;
  onClearBoard: () => void;
}

export function AssetPanel({
  mode,
  sourceLabel,
  assets,
  selectedAssetName,
  usedAssetNames,
  status,
  statusKind,
  locked = false,
  onReloadPresetAssets,
  onUploadFiles,
  onUploadError,
  onSelectAsset,
  onClearBoard,
}: AssetPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const images = Array.from(files || []).filter((file) => /image\/(png|jpeg)/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name));
    if (!images.length) {
      onUploadError("没有找到可上传的图片，请选择 PNG、JPG 或 JPEG 文件。");
      return;
    }
    if (images.length > 50) {
      onUploadError("单次最多上传 50 张图片，请减少图片数量后再试。");
      return;
    }
    if (images.length) onUploadFiles(images);
  };

  return (
    <section className="tab-pane active asset-panel" aria-label="图片素材">
      <input
        ref={fileInputRef}
        className="file-picker"
        type="file"
        accept="image/png,image/jpeg"
        multiple
        disabled={locked}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        className="file-picker"
        type="file"
        accept="image/png,image/jpeg"
        multiple
        disabled={locked}
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="folder-path">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M3.5 9.5h9l3 4h13v12a3 3 0 0 1-3 3h-19a3 3 0 0 1-3-3v-16Z" />
          <path d="M3.5 13.5h25" />
        </svg>
        <input
          className="folder-input"
          value={sourceLabel}
          readOnly
          aria-label="本次素材来源"
        />
        {mode === "cloud" && onReloadPresetAssets ? (
          <button className="tiny-btn" type="button" disabled={locked} onClick={onReloadPresetAssets}>示例</button>
        ) : null}
        <button className="tiny-btn" type="button" disabled={locked} onClick={() => fileInputRef.current?.click()}>图片</button>
        <button className="tiny-btn" type="button" disabled={locked} onClick={() => folderInputRef.current?.click()}>文件夹</button>
      </div>

      <div className="asset-title-row">
        <h2 className="asset-title">图片 ({assets.length})</h2>
        <button className="ghost-btn" type="button" disabled={locked} onClick={onClearBoard}>清空白板</button>
      </div>
      <div className={`status ${statusKind}`}>{status}</div>

      <div className="asset-list">
        {assets.map((asset) => {
          const used = usedAssetNames.has(asset.name);
          const selected = selectedAssetName === asset.name;
          return (
            <article
              className={`asset-card ${used ? "used" : ""} ${selected ? "selected" : ""}`}
              key={asset.name}
              draggable={!locked}
              onClick={() => {
                if (!locked) onSelectAsset(asset.name);
              }}
              onDragStart={(event) => {
                if (locked) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("text/plain", asset.name);
              }}
            >
              <div className="thumb-box">
                <img src={asset.url} alt={asset.name} />
              </div>
              <div className="asset-meta">
                <span className="asset-name" title={asset.name}>{asset.name}</span>
                <span>{asset.width || "-"} x {asset.height || "-"}</span>
                {used ? <span className="used-mark">已用</span> : <span className={`source-mark ${asset.source}`}>{asset.source === "uploaded" ? "上传" : "示例"}</span>}
              </div>
            </article>
          );
        })}
      </div>

      <button className="upload-card" type="button" disabled={locked} onClick={() => folderInputRef.current?.click()}>
        <span className="plus">+</span>
        <span>上传图片 / 选择文件夹</span>
        <span className="hint">支持 PNG / JPG / JPEG，上传后拖入左侧板块</span>
      </button>
    </section>
  );
}
