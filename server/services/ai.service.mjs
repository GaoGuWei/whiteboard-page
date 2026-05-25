import { callAnalyze, callAnalyzeImage, callOpenAI, callRebuildSolution, callSolutions } from "../ai/pipeline.mjs";
import { redactSecrets } from "../ai/client.mjs";

function normalizeAiError(error, fallback) {
  error.status = error.status || 502;
  error.publicMessage = redactSecrets(error.message || fallback);
  error.warnings = error.warnings || [];
  error.responseBody = {
    error: error.publicMessage,
    warnings: error.warnings,
  };
  return error;
}

export async function analyzePayload(payload) {
  try {
    return await callAnalyze(payload);
  } catch (error) {
    throw normalizeAiError(error, "Analysis failed");
  }
}

export async function analyzeImagePayload(payload) {
  try {
    return await callAnalyzeImage(payload);
  } catch (error) {
    throw normalizeAiError(error, "Image analysis failed");
  }
}

export async function generatePayload(payload) {
  try {
    return await callOpenAI(payload);
  } catch (error) {
    throw normalizeAiError(error, "Generation failed");
  }
}

export async function solutionsPayload(payload) {
  try {
    return await callSolutions(payload);
  } catch (error) {
    throw normalizeAiError(error, "Solutions failed");
  }
}

export async function rebuildSolutionPayload(payload) {
  try {
    return await callRebuildSolution(payload);
  } catch (error) {
    throw normalizeAiError(error, "Solution rebuild failed");
  }
}
