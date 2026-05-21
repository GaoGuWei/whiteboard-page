import { Router } from "express";
import { getAssets, getImage, selectFolder, uploadAssets } from "../controllers/assets.controller.mjs";
import { asyncHandler } from "../middlewares/async-handler.mjs";

const router = Router();

router.get("/assets", asyncHandler(getAssets));
router.post("/assets/upload", asyncHandler(uploadAssets));
router.get("/select-folder", asyncHandler(selectFolder));
router.get("/image", asyncHandler(getImage));

export default router;
