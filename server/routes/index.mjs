import { Router } from "express";
import assetsRoutes from "./assets.routes.mjs";
import aiRoutes from "./ai.routes.mjs";
import exportRoutes from "./export.routes.mjs";

const router = Router();

router.use(assetsRoutes);
router.use(aiRoutes);
router.use(exportRoutes);
router.use((req, res) => {
  res.status(404).json({ error: "API route not found" });
});

export default router;
