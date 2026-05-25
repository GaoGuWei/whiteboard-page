import { Router } from "express";
import {
  analyze,
  analyzeImage,
  generate,
  rebuildSolution,
  solutions,
  startAnalyzeStream,
  subscribeAnalyzeStreamController,
} from "../controllers/ai.controller.mjs";
import { asyncHandler } from "../middlewares/async-handler.mjs";

const router = Router();

router.post("/analyze", asyncHandler(analyze));
router.post("/analyze-image", asyncHandler(analyzeImage));
router.post("/analyze-stream/start", asyncHandler(startAnalyzeStream));
router.get("/analyze-stream/:jobId", subscribeAnalyzeStreamController);
router.post("/solutions/rebuild", asyncHandler(rebuildSolution));
router.post("/solutions", asyncHandler(solutions));
router.post("/generate", asyncHandler(generate));

export default router;
