import type { AnalyzeStreamStartResult, Asset, AssetSource, AssetUploadResult, GeneratePayload, GenerateResult, ImageRef, PinKey, ReviewImage, ReviewResult, QueueImage } from "./types";

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (response.status === 404 && (url.includes("/api/analyze-image") || url.includes("/api/analyze-stream"))) {
    throw new Error("后端服务版本过旧，请重启 API 服务后再试。");
  }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data as T;
}

function normalizeAssets(dir: string, source: AssetSource, assets: Asset[]): Asset[] {
  return assets.map((asset) => ({
    ...asset,
    id: asset.id || `${source}:${dir}:${asset.name}`,
    source: asset.source || source,
    imageDir: asset.imageDir || dir,
  }));
}

export async function listAssets(dir: string): Promise<{ dir: string; assets: Asset[] }> {
  const result = await jsonRequest<{ dir: string; assets: Asset[] }>(`/api/assets?dir=${encodeURIComponent(dir)}`);
  return { ...result, assets: normalizeAssets(result.dir, "preset", result.assets) };
}

export async function selectFolder(dir: string): Promise<{ dir: string }> {
  return jsonRequest(`/api/select-folder?dir=${encodeURIComponent(dir)}`);
}

export async function uploadAssets(files: File[]): Promise<AssetUploadResult> {
  const body = new FormData();
  files.forEach((file) => body.append("images", file, file.webkitRelativePath || file.name));
  const result = await jsonRequest<AssetUploadResult>("/api/assets/upload", {
    method: "POST",
    body,
  });
  return { ...result, assets: normalizeAssets(result.dir, "uploaded", result.assets) };
}

export async function analyzeImages(payload: GeneratePayload): Promise<ReviewResult> {
  return jsonRequest("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function analyzeSingleImage(payload: GeneratePayload, image: ImageRef): Promise<ReviewImage> {
  return jsonRequest("/api/analyze-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, image }),
  });
}

export async function startAnalyzeStream(payload: GeneratePayload): Promise<AnalyzeStreamStartResult> {
  return jsonRequest("/api/analyze-stream/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function generateTranscript(
  payload: GeneratePayload,
  confirmedImages: QueueImage[],
  options: {
    previousTranscript?: string;
    pinnedSections?: Partial<Record<PinKey, boolean>>;
  } = {},
): Promise<GenerateResult> {
  return jsonRequest("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, confirmedImages, ...options }),
  });
}

export async function exportDocx(title: string, markdown: string): Promise<Blob> {
  const response = await fetch("/api/export/docx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, markdown }),
  });
  if (!response.ok) throw new Error("Word 导出失败");
  return response.blob();
}
