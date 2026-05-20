import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import apiRoutes from "./routes/index.mjs";
import { errorHandler } from "./middlewares/error-handler.mjs";
import { notFound } from "./middlewares/not-found.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = resolve(rootDir, "dist");
const distIndex = resolve(distDir, "index.html");

export const app = express();

app.use(express.json({ limit: "10mb" }));
app.use("/api", apiRoutes);
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (!existsSync(distIndex)) return next();
  return res.sendFile(distIndex);
});
app.use(notFound);
app.use(errorHandler);
