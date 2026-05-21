import { listAssets, uploadAssets } from "./api";
import type { AppMode, AssetSource, ImageAsset } from "./types";

export interface ImageSourceResult {
  dir: string;
  assets: ImageAsset[];
}

export interface ImageSourceAdapter {
  mode: AppMode;
  supportsPresetAssets: boolean;
  initialSource: AssetSource;
  initialStatus: string;
  loadInitialAssets: () => Promise<ImageSourceResult>;
  importFiles: (files: File[]) => Promise<ImageSourceResult>;
}

function appMode(): AppMode {
  return import.meta.env.VITE_APP_MODE === "local" ? "local" : "cloud";
}

export const APP_MODE = appMode();

export function createImageSourceAdapter(mode: AppMode = APP_MODE): ImageSourceAdapter {
  if (mode === "local") {
    return {
      mode,
      supportsPresetAssets: false,
      initialSource: "uploaded",
      initialStatus: "请选择本机图片或文件夹。",
      loadInitialAssets: async () => ({ dir: "", assets: [] }),
      importFiles: uploadAssets,
    };
  }

  return {
    mode,
    supportsPresetAssets: true,
    initialSource: "preset",
    initialStatus: "准备读取服务器示例素材。",
    loadInitialAssets: () => listAssets(""),
    importFiles: uploadAssets,
  };
}

