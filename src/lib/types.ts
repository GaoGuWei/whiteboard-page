export type SectionId = "review" | "interest" | "mindmap" | "knowledge" | "test";

export interface Asset {
  name: string;
  width: number;
  height: number;
  bytes?: number;
  url: string;
}

export interface SectionDefinition {
  id: SectionId;
  title: string;
  hint: string;
  wide?: boolean;
}

export interface SectionState {
  assets: Asset[];
  note: string;
}

export type SectionsState = Record<SectionId, SectionState>;
export type PinKey = SectionId | "title";

export interface GeneratePayload {
  title: string;
  template: string;
  imageDir: string;
  sections: Array<{
    id: SectionId;
    title: string;
    note: string;
    assets: Array<Pick<Asset, "name" | "width" | "height">>;
  }>;
}

export interface ImageRef {
  sectionId: SectionId;
  assetName: string;
  order: number;
}

export interface AnalysisProgress {
  phase: "idle" | "analyzing" | "generating" | "done" | "error";
  total: number;
  done: number;
  current?: string;
}

export interface RiskItem {
  id: string;
  field: string;
  currentText: string;
  suggestedText: string;
  reason: string;
  severity: "high" | "medium" | "low" | string;
}

export interface ReviewImage {
  imageId: string;
  sectionId: SectionId;
  sectionTitle: string;
  assetName: string;
  order: number;
  width: number;
  height: number;
  ocrText: string;
  riskItems: RiskItem[];
  summary: string;
  status: "queued" | "analyzing" | "needs_review" | "confirmed" | "failed";
}

export interface ReviewResult {
  mode: "ai" | "mock";
  images: ReviewImage[];
  analysis?: string;
  needsReview?: boolean;
  reviewItems?: RiskItem[];
  pendingCount?: number;
  confirmedCount?: number;
  warnings?: string[];
}

export interface AnalyzeStreamStartResult {
  jobId: string;
}

export type AnalyzeStreamEvent =
  | { type: "job-start"; data: { jobId: string; total: number; done: number } }
  | { type: "image-start"; data: ImageRef & { imageId: string; done: number; total: number } }
  | { type: "image-done"; data: { image: ReviewImage; done: number; total: number } }
  | { type: "image-error"; data: { image: ReviewImage; error: string; done: number; total: number } }
  | { type: "job-done"; data: { images: ReviewImage[]; pendingCount: number; confirmedCount: number } }
  | { type: "job-error"; data: { error: string; done: number; total: number } };

export interface QueueImage {
  imageId: string;
  sectionId: SectionId;
  sectionTitle: string;
  assetName: string;
  order: number;
  ocrText: string;
  corrections: Array<{
    id: string;
    field: string;
    originalText: string;
    correctedText: string;
  }>;
}

export interface GenerateResult {
  mode: "ai" | "mock";
  text: string;
  analysis?: string;
  warnings?: string[];
  needsReview?: boolean;
  reviewItems?: RiskItem[];
  images?: ReviewImage[];
  usedConfirmedImages?: boolean;
  usedPinnedSections?: boolean;
  skippedGeneration?: boolean;
}
