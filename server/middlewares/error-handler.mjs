import { redactSecrets } from "../ai/client.mjs";

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  const status = Number(error.status || error.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const fallback = safeStatus === 500 ? "Internal server error" : "Request failed";
  if (error.responseBody) {
    res.status(safeStatus).json(error.responseBody);
    return;
  }
  res.status(safeStatus).json({ error: redactSecrets(error.publicMessage || error.message || fallback) });
}
