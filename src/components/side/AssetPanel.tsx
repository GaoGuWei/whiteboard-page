import type { Asset } from "../../lib/types";

interface AssetPanelProps {
  dir: string;
  assets: Asset[];
  selectedAssetName: string | null;
  usedAssetNames: Set<string>;
  status: string;
  statusKind: "ok" | "error" | "";
  onDirChange: (value: string) => void;
  onRead: () => void;
  onSelectFolder: () => void;
  onSelectAsset: (assetName: string) => void;
  onClearBoard: () => void;
}

export function AssetPanel({
  dir,
  assets,
  selectedAssetName,
  usedAssetNames,
  status,
  statusKind,
  onDirChange,
  onRead,
  onSelectFolder,
  onSelectAsset,
  onClearBoard,
}: AssetPanelProps) {
  return (
    <section className="tab-pane active asset-panel" aria-label="图片素材">
      <div className="folder-path" onDoubleClick={onSelectFolder}>
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M3.5 9.5h9l3 4h13v12a3 3 0 0 1-3 3h-19a3 3 0 0 1-3-3v-16Z" />
          <path d="M3.5 13.5h25" />
        </svg>
        <input
          className="folder-input"
          value={dir}
          onChange={(event) => onDirChange(event.target.value)}
          onClick={onSelectFolder}
          aria-label="图片素材文件夹路径"
        />
        <button className="tiny-btn" type="button" onClick={onRead}>读取</button>
        <button className="tiny-btn" type="button" onClick={onSelectFolder}>选择</button>
      </div>

      <div className="asset-title-row">
        <h2 className="asset-title">图片 ({assets.length})</h2>
        <button className="ghost-btn" type="button" onClick={onClearBoard}>清空白板</button>
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
              draggable
              onClick={() => onSelectAsset(asset.name)}
              onDragStart={(event) => {
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
                {used ? <span className="used-mark">已用</span> : <span>拖入</span>}
              </div>
            </article>
          );
        })}
      </div>

      <button className="upload-card" type="button" onClick={onSelectFolder}>
        <span className="plus">+</span>
        <span>选择图片文件夹</span>
        <span className="hint">支持 PNG / JPG / JPEG，拖入左侧板块</span>
      </button>
    </section>
  );
}
