import { Router } from "express";
import { exportDocx } from "../controllers/export.controller.mjs";
import { asyncHandler } from "../middlewares/async-handler.mjs";

const router = Router();

router.post("/export/docx", asyncHandler(exportDocx));

export default router;
