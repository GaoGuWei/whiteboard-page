export type SectionId = "review" | "interest" | "mindmap" | "knowledge" | "test";
export type AppMode = "local" | "cloud";
export type AssetSource = "preset" | "uploaded";

export interface ImageAsset {
  id: string;
  source: AssetSource;
  name: string;
  width: number;
  height: number;
  bytes?: number;
  url: string;
  imageDir?: string;
  path?: string;
}

export type Asset = ImageAsset;

export interface AssetUploadResult {
  dir: string;
  assets: ImageAsset[];
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
  contentType?: "problem" | "explanation";
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
  contentType?: "problem" | "explanation";
  ocrText: string;
  corrections: Array<{
    id: string;
    field: string;
    originalText: string;
    correctedText: string;
  }>;
}

export interface SolutionResult {
  problemId: string;
  imageId?: string;
  assetName?: string;
  order?: number;
  sectionId: SectionId;
  problemText?: string;
  hasProvidedAnswer?: boolean;
  providedAnswer?: string;
  providedSolutionSteps?: string[];
  solutionSource?: "image_full_solution" | "image_answer_ai_steps" | "ai_generated" | "unclear" | string;
  problemType: "algebra" | "geometry_calculation" | "geometry_proof" | "conic" | "function_graph" | "unknown" | string;
  topicType?: "algebra" | "geometry" | "function" | "conic" | "statistics" | "unknown" | string;
  geometryAnalysis?: {
    given: string[];
    diagramRelations: string[];
    target: string;
    auxiliaryLines: string[];
    theorems: string[];
    proofChain: Array<{
      from: string;
      reason: string;
      to: string;
    }>;
  };
  finalAnswer: string;
  solutionSteps: string[];
  keyTheorems: string[];
  boardWriting: string[];
  studentPitfalls: string[];
}

export interface GenerateResult {
  mode: "ai" | "mock";
  text: string;
  analysis?: string;
  warnings?: string[];
  solutions?: SolutionResult[];
  solutionValidation?: {
    passed: boolean;
    checkedCount: number;
    repairedCount: number;
    items?: Array<{
      problemId: string;
      passed: boolean;
      missing: string[];
      reason: string;
    }>;
    summary?: string;
  };
  solutionWarnings?: string[];
  needsReview?: boolean;
  reviewItems?: RiskItem[];
  images?: ReviewImage[];
  usedConfirmedImages?: boolean;
  usedPinnedSections?: boolean;
  skippedGeneration?: boolean;
}

export interface SolutionPackageResult {
  mode: "ai" | "mock";
  analysis: string;
  warnings?: string[];
  solutions: SolutionResult[];
  solutionValidation?: GenerateResult["solutionValidation"];
  solutionWarnings?: string[];
  usedConfirmedImages?: boolean;
}

export interface SolutionRebuildResult {
  mode: "ai" | "mock";
  solution: SolutionResult;
  warnings?: string[];
}
