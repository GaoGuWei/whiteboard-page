import { analyzeImagePayload, analyzePayload, generatePayload } from "../services/ai.service.mjs";
import { startAnalyzeStreamJob, subscribeAnalyzeStream } from "../services/analyze-stream.service.mjs";

export async function analyze(req, res) {
  res.json(await analyzePayload(req.body));
}

export async function analyzeImage(req, res) {
  res.json(await analyzeImagePayload(req.body));
}

export async function generate(req, res) {
  res.json(await generatePayload(req.body));
}

export async function startAnalyzeStream(req, res) {
  res.json(startAnalyzeStreamJob(req.body));
}

export function subscribeAnalyzeStreamController(req, res) {
  subscribeAnalyzeStream(req.params.jobId, res);
}
