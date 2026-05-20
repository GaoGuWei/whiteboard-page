import { AI_BASE_URL, AI_MODEL } from "../config.mjs";

export function getApiKey() {
  return process.env.YI_API_KEY || process.env.OPENAI_API_KEY || "";
}

export function redactSecrets(text) {
  const apiKey = getApiKey();
  let redacted = String(text || "").replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_API_KEY]");
  if (apiKey) redacted = redacted.replaceAll(apiKey, "[REDACTED_API_KEY]");
  return redacted;
}

export function normalizeApiError(status, detail) {
  const redacted = redactSecrets(detail).slice(0, 1200);
  return `AI 生成失败：${status}${redacted ? ` ${redacted}` : ""}`;
}

export async function createResponse(content) {
  const apiKey = getApiKey();
  const response = await fetch(`${AI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      input: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(normalizeApiError(response.status, detail));
  }

  const data = await response.json();
  return (
    data.output_text ||
    data.output
      ?.flatMap((item) => item.content || [])
      .map((item) => item.text || "")
      .join("\n")
      .trim() ||
    ""
  );
}
