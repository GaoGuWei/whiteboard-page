import { escapeHtml } from "./mathPreview";

function parseGraphConfig(configText: string): Record<string, string> {
  const config: Record<string, string> = {};
  for (const line of configText.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    config[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return config;
}

function graphValue(type: string, x: number): number | null {
  if (type === "linear") return x;
  if (type === "quadratic") return x * x;
  if (type === "inverse") return Math.abs(x) < 0.18 ? null : 1 / x;
  if (type === "power") return x >= 0 ? Math.sqrt(x) : null;
  return null;
}

export function renderGraphBlock(configText: string): string {
  const config = parseGraphConfig(configText);
  const type = config.type || "quadratic";
  if (!["linear", "quadratic", "inverse", "power"].includes(type)) {
    return `<pre class="code-block">${escapeHtml(configText)}</pre>`;
  }

  const width = 360;
  const height = 240;
  const pad = 28;
  const xMin = Number(config.xMin ?? -5);
  const xMax = Number(config.xMax ?? 5);
  const yMin = Number(config.yMin ?? -5);
  const yMax = Number(config.yMax ?? 10);
  const sx = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - yMin) / (yMax - yMin)) * (height - pad * 2);
  const xAxis = sy(0);
  const yAxis = sx(0);
  const paths: string[][] = [[]];

  for (let i = 0; i <= 160; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / 160;
    const y = graphValue(type, x);
    if (y === null || y < yMin || y > yMax) {
      if (paths.at(-1)?.length) paths.push([]);
      continue;
    }
    paths.at(-1)?.push(`${paths.at(-1)?.length ? "L" : "M"}${sx(x).toFixed(2)},${sy(y).toFixed(2)}`);
  }

  const keyPoints = (config.keyPoints || "")
    .split(";")
    .map((point) => point.split(",").map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  return `
    <div class="math-graph">
      <div class="math-graph-title">${escapeHtml(config.title || config.expression || "函数图像")}</div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(config.title || "函数图像")}">
        <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#f8fafd" />
        ${Array.from({ length: 9 }, (_, i) => {
          const x = pad + (i * (width - pad * 2)) / 8;
          const y = pad + (i * (height - pad * 2)) / 8;
          return `<path d="M${x},${pad}V${height - pad}M${pad},${y}H${width - pad}" stroke="#e4ecf6" stroke-width="1" />`;
        }).join("")}
        <path d="M${pad},${xAxis}H${width - pad}M${yAxis},${pad}V${height - pad}" stroke="#7c8eaa" stroke-width="1.4" />
        ${paths.map((path) => `<path d="${path.join(" ")}" fill="none" stroke="#1683ff" stroke-width="2.4" stroke-linecap="round" />`).join("")}
        ${keyPoints.map(([x, y]) => `<circle cx="${sx(x)}" cy="${sy(y)}" r="3.5" fill="#1a9d6c" />`).join("")}
      </svg>
    </div>
  `;
}
