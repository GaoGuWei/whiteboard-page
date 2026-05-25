import { compile } from "mathjs";
import { escapeHtml } from "./mathPreview";

type Coord = [number, number];
type Point = { x?: number; y?: number; label?: string; name?: string };
type Segment = { from?: string | Coord; to?: string | Coord; label?: string; dashed?: boolean };
type LineConfig = { from?: Coord; to?: Coord; expression?: string; dashed?: boolean; label?: string };
type CircleConfig = { center?: string | Coord; radius?: number; label?: string };
type EllipseConfig = { center?: Coord; rx?: number; ry?: number; a?: number; b?: number; label?: string };
type ParabolaConfig = { vertex?: Coord; p?: number; orientation?: string; label?: string };
type HyperbolaConfig = { center?: Coord; a?: number; b?: number; orientation?: string; asymptotes?: string[]; label?: string };
type PolygonConfig = { type?: string; vertices?: Array<string | Coord>; label?: string };
type CurveConfig = {
  type?: string;
  kind?: string;
  expression?: string;
  x?: string;
  y?: string;
  domain?: Coord;
  tMin?: number;
  tMax?: number;
  center?: Coord;
  radius?: number;
  rx?: number;
  ry?: number;
  a?: number;
  b?: number;
  p?: number;
  orientation?: string;
  branch?: string;
  features?: string[];
};
type MathGraphConfig = {
  version?: string;
  role?: string;
  label?: string;
  title?: string;
  graphType?: string;
  source?: string;
  confidence?: number | string;
  rawDescription?: string;
  unclearItems?: string[];
  axes?: {
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
    xLabel?: string;
    yLabel?: string;
    dashedLines?: Array<{ axis?: "x" | "y"; value: number; label?: string }>;
    asymptotes?: Array<{ axis?: "x" | "y"; value?: number; expression?: string; label?: string }>;
  };
  curves?: CurveConfig[];
  points?: Point[];
  segments?: Segment[];
  lines?: LineConfig[];
  circles?: CircleConfig[];
  ellipses?: EllipseConfig[];
  parabolas?: ParabolaConfig[];
  hyperbolas?: HyperbolaConfig[];
  polygons?: PolygonConfig[];
  angleMarks?: unknown[];
  rightAngleMarks?: unknown[];
  equalMarks?: unknown[];
  annotations?: Array<{ x?: number; y?: number; text: string }>;
  qualitativeFeatures?: string[];
};

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

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listItems(items: unknown[] | undefined, fallback = "无") {
  const values = Array.isArray(items) ? items.map((item) => String(item || "").trim()).filter(Boolean) : [];
  return values.length ? values.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : `<li>${escapeHtml(fallback)}</li>`;
}

function graphTitle(config: MathGraphConfig) {
  return config.title || [config.label, config.graphType].filter(Boolean).join(" - ") || "结构化数学图形";
}

function renderGraphCard(config: MathGraphConfig, message = "暂以结构化图形卡片展示") {
  const field = (label: string, value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return text && text !== "\"\"" ? `<div><strong>${escapeHtml(label)}：</strong>${escapeHtml(text)}</div>` : "";
  };
  return `
    <div class="math-graph math-graph-json graph-card">
      <div class="math-graph-title">${escapeHtml(graphTitle(config))}</div>
      <div class="graph-card-body">
        <p>${escapeHtml(message)}</p>
        ${field("类型", config.graphType)}
        ${field("来源", config.source)}
        ${field("置信度", config.confidence)}
        ${field("原图描述", config.rawDescription)}
        ${field("点", config.points)}
        ${field("线段", config.segments)}
        ${field("圆", config.circles)}
        ${field("椭圆", config.ellipses)}
        ${field("抛物线", config.parabolas)}
        ${field("双曲线", config.hyperbolas)}
        ${field("多边形", config.polygons)}
        <div><strong>关键特征：</strong><ul>${listItems(config.qualitativeFeatures)}</ul></div>
        <div><strong>不确定项：</strong><ul>${listItems(config.unclearItems, "无明显不确定项")}</ul></div>
      </div>
    </div>
  `;
}

function renderGraphError(message: string) {
  return `
    <div class="math-graph math-graph-json graph-error">
      <div class="math-graph-title">math-graph-json 渲染提示</div>
      <div class="graph-card-body">${escapeHtml(message)}</div>
    </div>
  `;
}

function svgFrame(config: MathGraphConfig, abstract = false) {
  const width = 360;
  const height = 240;
  const pad = 28;
  const axes = config.axes || {};
  const xMin = abstract ? 0 : numberValue(axes.xMin, -5);
  const xMax = abstract ? 10 : numberValue(axes.xMax, 5);
  const yMin = abstract ? 0 : numberValue(axes.yMin, -6);
  const yMax = abstract ? 7 : numberValue(axes.yMax, 6);
  const sx = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - yMin) / (yMax - yMin)) * (height - pad * 2);
  const inRange = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && x >= xMin && x <= xMax && y >= yMin && y <= yMax;
  return { width, height, pad, xMin, xMax, yMin, yMax, sx, sy, inRange };
}

function coord(value: unknown): Coord | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  return null;
}

function defaultPolygonCoords(count: number): Coord[] {
  if (count === 3) return [[2, 1], [8, 1], [5, 5.8]];
  if (count === 4) return [[2, 1], [8, 1.2], [7.2, 5.7], [2.4, 5.2]];
  return Array.from({ length: count }, (_, index) => {
    const t = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
    return [5 + 3 * Math.cos(t), 3.5 + 2.4 * Math.sin(t)];
  });
}

function pointLabel(point: Point, index: number) {
  return String(point.label || point.name || String.fromCharCode(65 + index));
}

function buildPointMap(config: MathGraphConfig) {
  const labels = new Set<string>();
  const sourcePoints = Array.isArray(config.points) ? config.points : [];
  sourcePoints.forEach((point, index) => labels.add(pointLabel(point, index)));
  (config.polygons || []).forEach((polygon) => (polygon.vertices || []).forEach((vertex) => {
    if (typeof vertex === "string") labels.add(vertex);
  }));
  const defaults = defaultPolygonCoords(Math.max(labels.size, sourcePoints.length, 3));
  const map = new Map<string, Coord>();
  sourcePoints.forEach((point, index) => {
    const label = pointLabel(point, index);
    const x = Number(point.x);
    const y = Number(point.y);
    map.set(label, Number.isFinite(x) && Number.isFinite(y) ? [x, y] : defaults[index] || defaults[0]);
  });
  Array.from(labels).forEach((label, index) => {
    if (!map.has(label)) map.set(label, defaults[index] || defaults[0]);
  });
  return map;
}

function resolveCoord(value: string | Coord | undefined, points: Map<string, Coord>): Coord | null {
  if (typeof value === "string") return points.get(value) || null;
  return coord(value);
}

function pathFromPoints(points: Coord[], frame: ReturnType<typeof svgFrame>) {
  const paths: string[][] = [[]];
  for (const [x, y] of points) {
    if (!frame.inRange(x, y)) {
      if (paths.at(-1)?.length) paths.push([]);
      continue;
    }
    const current = paths.at(-1);
    current?.push(`${current.length ? "L" : "M"}${frame.sx(x).toFixed(2)},${frame.sy(y).toFixed(2)}`);
  }
  return paths.filter((path) => path.length).map((path) => path.join(" "));
}

function sampleExplicitCurve(curve: CurveConfig, frame: ReturnType<typeof svgFrame>) {
  if (!curve.expression) return [];
  const expr = compile(curve.expression);
  const [start, end] = curve.domain || [frame.xMin, frame.xMax];
  const points: Coord[] = [];
  for (let i = 0; i <= 240; i += 1) {
    const x = start + ((end - start) * i) / 240;
    try {
      points.push([x, Number(expr.evaluate({ x }))]);
    } catch {
      points.push([Number.NaN, Number.NaN]);
    }
  }
  return pathFromPoints(points, frame);
}

function sampleParametricCurve(curve: CurveConfig, frame: ReturnType<typeof svgFrame>) {
  if (!curve.x || !curve.y) return [];
  const xExpr = compile(curve.x);
  const yExpr = compile(curve.y);
  const tMin = numberValue(curve.tMin, 0);
  const tMax = numberValue(curve.tMax, Math.PI * 2);
  const points: Coord[] = [];
  for (let i = 0; i <= 260; i += 1) {
    const t = tMin + ((tMax - tMin) * i) / 260;
    try {
      points.push([Number(xExpr.evaluate({ t })), Number(yExpr.evaluate({ t }))]);
    } catch {
      points.push([Number.NaN, Number.NaN]);
    }
  }
  return pathFromPoints(points, frame);
}

function sampleConicCurve(curve: CurveConfig, frame: ReturnType<typeof svgFrame>) {
  const [h, k] = curve.center || [0, 0];
  const kind = curve.kind || curve.type || "ellipse";
  const points: Coord[] = [];
  if (kind === "circle") {
    const r = numberValue(curve.radius, 1);
    for (let i = 0; i <= 260; i += 1) {
      const t = (Math.PI * 2 * i) / 260;
      points.push([h + r * Math.cos(t), k + r * Math.sin(t)]);
    }
    return pathFromPoints(points, frame);
  }
  if (kind === "ellipse") {
    const a = numberValue(curve.a ?? curve.rx, 2);
    const b = numberValue(curve.b ?? curve.ry, 1);
    for (let i = 0; i <= 260; i += 1) {
      const t = (Math.PI * 2 * i) / 260;
      points.push([h + a * Math.cos(t), k + b * Math.sin(t)]);
    }
    return pathFromPoints(points, frame);
  }
  if (kind === "hyperbola") {
    const a = numberValue(curve.a, 1);
    const b = numberValue(curve.b, 1);
    const paths: string[] = [];
    for (const sign of [-1, 1]) {
      const branch: Coord[] = [];
      for (let i = -140; i <= 140; i += 1) {
        const t = i / 36;
        branch.push([h + sign * a * Math.cosh(t), k + b * Math.sinh(t)]);
      }
      paths.push(...pathFromPoints(branch, frame));
    }
    return paths;
  }
  if (kind === "parabola") {
    const p = numberValue(curve.p, 1);
    const vertical = !/left|right|horizontal/.test(curve.orientation || "vertical");
    const direction = /down|left/.test(curve.orientation || "") ? -1 : 1;
    for (let i = -160; i <= 160; i += 1) {
      const t = i / 32;
      points.push(vertical ? [h + t, k + direction * (t * t) / (4 * p)] : [h + direction * (t * t) / (4 * p), k + t]);
    }
    return pathFromPoints(points, frame);
  }
  return [];
}

function qualitativeCurve(curve: CurveConfig, config: MathGraphConfig, frame: ReturnType<typeof svgFrame>) {
  const features = [...(curve.features || []), ...(config.qualitativeFeatures || []), config.rawDescription || ""].join(" ");
  const increasing = /递增|increasing|上升|左下.*右上|从左下.*右上/.test(features);
  const decreasing = /递减|decreasing|下降|左上.*右下|从左上.*右下/.test(features);
  const sShape = /S|穿过原点|odd|奇/.test(features);
  const bounded = /渐近线|bounded|趋近/.test(features);
  const points: Coord[] = [];
  for (let i = 0; i <= 160; i += 1) {
    const x = frame.xMin + ((frame.xMax - frame.xMin) * i) / 160;
    let y = increasing ? Math.tanh(x) : decreasing ? -Math.tanh(x) : Math.sin(x);
    if (!bounded && sShape) y = x * x * x / 8;
    points.push([x, y]);
  }
  return pathFromPoints(points, frame);
}

function conicCurvesFromV1(config: MathGraphConfig): CurveConfig[] {
  const curves: CurveConfig[] = [];
  (config.circles || []).forEach((circle) => curves.push({ type: "conic", kind: "circle", center: coord(circle.center) || [0, 0], radius: circle.radius }));
  (config.ellipses || []).forEach((ellipse) => curves.push({ type: "conic", kind: "ellipse", center: ellipse.center || [0, 0], rx: ellipse.rx ?? ellipse.a, ry: ellipse.ry ?? ellipse.b }));
  (config.parabolas || []).forEach((parabola) => curves.push({ type: "conic", kind: "parabola", center: parabola.vertex || [0, 0], p: parabola.p, orientation: parabola.orientation }));
  (config.hyperbolas || []).forEach((hyperbola) => curves.push({ type: "conic", kind: "hyperbola", center: hyperbola.center || [0, 0], a: hyperbola.a, b: hyperbola.b, orientation: hyperbola.orientation }));
  return curves;
}

function curvePaths(curve: CurveConfig, config: MathGraphConfig, frame: ReturnType<typeof svgFrame>) {
  const type = curve.type || config.graphType || "function";
  if (type === "parametric") return sampleParametricCurve(curve, frame);
  if (type === "conic" || ["conic_ellipse", "conic_hyperbola", "conic_parabola", "conic", "geometry_circle"].includes(config.graphType || "")) return sampleConicCurve(curve, frame);
  if (type === "qualitative" || config.graphType === "qualitative_curve" || !curve.expression) return qualitativeCurve(curve, config, frame);
  return sampleExplicitCurve(curve, frame);
}

function renderAxes(config: MathGraphConfig, frame: ReturnType<typeof svgFrame>, abstract = false) {
  const { width, height, pad, sx, sy } = frame;
  const xAxis = sy(0);
  const yAxis = sx(0);
  const dashedLines = config.axes?.dashedLines || [];
  const asymptotes = config.axes?.asymptotes || [];
  return `
    <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#f8fafd" />
    ${!abstract ? Array.from({ length: 9 }, (_, i) => {
      const x = pad + (i * (width - pad * 2)) / 8;
      const y = pad + (i * (height - pad * 2)) / 8;
      return `<path d="M${x},${pad}V${height - pad}M${pad},${y}H${width - pad}" stroke="#e4ecf6" stroke-width="1" />`;
    }).join("") : ""}
    ${!abstract ? `<path d="M${pad},${xAxis}H${width - pad}M${yAxis},${pad}V${height - pad}" stroke="#7c8eaa" stroke-width="1.4" />
    <text x="${width - pad + 8}" y="${xAxis - 5}" font-size="12" fill="#53657f">${escapeHtml(config.axes?.xLabel || "x")}</text>
    <text x="${yAxis + 6}" y="${pad - 8}" font-size="12" fill="#53657f">${escapeHtml(config.axes?.yLabel || "y")}</text>` : ""}
    ${[...dashedLines, ...asymptotes].map((line) => {
      if (line.axis === "y" && Number.isFinite(Number(line.value))) return `<path d="M${pad},${sy(Number(line.value))}H${width - pad}" stroke="#475569" stroke-width="1.4" stroke-dasharray="7 7" />`;
      if (line.axis === "x" && Number.isFinite(Number(line.value))) return `<path d="M${sx(Number(line.value))},${pad}V${height - pad}" stroke="#475569" stroke-width="1.4" stroke-dasharray="7 7" />`;
      return "";
    }).join("")}
  `;
}

function renderGeometrySvg(config: MathGraphConfig) {
  const frame = svgFrame(config, true);
  const pointMap = buildPointMap(config);
  const title = graphTitle(config);
  const polygons = (config.polygons || []).map((polygon) => {
    const coords = (polygon.vertices || []).map((vertex) => resolveCoord(vertex, pointMap)).filter(Boolean) as Coord[];
    if (coords.length < 3) return "";
    const d = coords.map(([x, y], index) => `${index ? "L" : "M"}${frame.sx(x)},${frame.sy(y)}`).join("") + "Z";
    return `<path d="${d}" fill="#dbeafe" stroke="#1683ff" stroke-width="2.2" />`;
  }).join("");
  const segments = (config.segments || []).map((segment) => {
    const from = resolveCoord(segment.from, pointMap);
    const to = resolveCoord(segment.to, pointMap);
    if (!from || !to) return "";
    return `<path d="M${frame.sx(from[0])},${frame.sy(from[1])}L${frame.sx(to[0])},${frame.sy(to[1])}" stroke="#334155" stroke-width="1.8" ${segment.dashed ? 'stroke-dasharray="6 6"' : ""} />`;
  }).join("");
  const circles = (config.circles || []).map((circle) => {
    const center = resolveCoord(circle.center, pointMap) || [5, 3.5];
    const radius = numberValue(circle.radius, 1.6);
    const radiusText = Number.isFinite(Number(circle.radius)) ? "" : `<text x="${frame.sx(center[0]) + 8}" y="${frame.sy(center[1]) + 34}" font-size="11" fill="#b45309">半径未识别</text>`;
    return `<circle cx="${frame.sx(center[0])}" cy="${frame.sy(center[1])}" r="${Math.abs(frame.sx(center[0] + radius) - frame.sx(center[0]))}" fill="none" stroke="#1683ff" stroke-width="2.2" />${radiusText}`;
  }).join("");
  const points = Array.from(pointMap.entries()).map(([label, [x, y]]) => `
    <circle cx="${frame.sx(x)}" cy="${frame.sy(y)}" r="3.8" fill="#1a9d6c" />
    <text x="${frame.sx(x) + 6}" y="${frame.sy(y) - 6}" font-size="12" fill="#334155">${escapeHtml(label)}</text>
  `).join("");
  return `
    <div class="math-graph math-graph-json">
      <div class="math-graph-title">${escapeHtml(title)}</div>
      <svg viewBox="0 0 ${frame.width} ${frame.height}" role="img" aria-label="${escapeHtml(title)}">
        ${renderAxes(config, frame, true)}
        ${polygons || circles ? "" : `<path d="M${frame.sx(2)},${frame.sy(1)}L${frame.sx(8)},${frame.sy(1)}L${frame.sx(5)},${frame.sy(5.8)}Z" fill="#dbeafe" stroke="#1683ff" stroke-width="2.2" />`}
        ${polygons}
        ${circles}
        ${segments}
        ${points}
      </svg>
      ${renderFeatureSummary(config)}
    </div>
  `;
}

function renderFeatureSummary(config: MathGraphConfig) {
  const features = [...(config.qualitativeFeatures || [])];
  const hyperbolaAsymptotes = (config.hyperbolas || []).flatMap((item) => item.asymptotes || []);
  const axisAsymptotes = (config.axes?.asymptotes || []).map((item) => item.label || item.expression || `${item.axis}=${item.value}`);
  const unclear = config.unclearItems || [];
  if (!features.length && !hyperbolaAsymptotes.length && !axisAsymptotes.length && !unclear.length) return "";
  return `
    <div class="graph-card-body">
      ${features.length ? `<div><strong>关键特征：</strong><ul>${listItems(features)}</ul></div>` : ""}
      ${hyperbolaAsymptotes.length || axisAsymptotes.length ? `<div><strong>渐近线：</strong><ul>${listItems([...hyperbolaAsymptotes, ...axisAsymptotes])}</ul></div>` : ""}
      ${unclear.length ? `<div><strong>不确定项：</strong><ul>${listItems(unclear)}</ul></div>` : ""}
    </div>
  `;
}

function renderCoordinateSvg(config: MathGraphConfig) {
  const frame = svgFrame(config);
  const v1Curves = conicCurvesFromV1(config);
  const curves = [
    ...(Array.isArray(config.curves) ? config.curves : []),
    ...v1Curves,
  ];
  const drawableCurves = curves.length ? curves : [{ type: "qualitative", features: config.qualitativeFeatures || [] }];
  const paths = drawableCurves.flatMap((curve) => curvePaths(curve, config, frame));
  if (!paths.length && !config.axes && !v1Curves.length) return renderGraphCard(config);
  const points = Array.isArray(config.points) ? config.points : [];
  const lines = Array.isArray(config.lines) ? config.lines : [];
  const annotations = Array.isArray(config.annotations) ? config.annotations : [];
  const title = graphTitle(config);
  return `
    <div class="math-graph math-graph-json">
      <div class="math-graph-title">${escapeHtml(title)}</div>
      <svg viewBox="0 0 ${frame.width} ${frame.height}" role="img" aria-label="${escapeHtml(title)}">
        ${renderAxes(config, frame)}
        ${lines.map((line) => {
          if (line.from && line.to) {
            return `<path d="M${frame.sx(line.from[0])},${frame.sy(line.from[1])}L${frame.sx(line.to[0])},${frame.sy(line.to[1])}" stroke="#64748b" stroke-width="1.5" ${line.dashed ? 'stroke-dasharray="6 6"' : ""} />`;
          }
          return "";
        }).join("")}
        ${paths.map((path) => `<path d="${path}" fill="none" stroke="#1683ff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />`).join("")}
        ${points.filter((point) => frame.inRange(Number(point.x), Number(point.y))).map((point, index) => `
          <circle cx="${frame.sx(Number(point.x))}" cy="${frame.sy(Number(point.y))}" r="3.5" fill="#1a9d6c" />
          <text x="${frame.sx(Number(point.x)) + 5}" y="${frame.sy(Number(point.y)) - 5}" font-size="12" fill="#334155">${escapeHtml(pointLabel(point, index))}</text>
        `).join("")}
        ${annotations.map((item) => Number.isFinite(item.x) && Number.isFinite(item.y) ? `<text x="${frame.sx(Number(item.x))}" y="${frame.sy(Number(item.y))}" font-size="12" fill="#334155">${escapeHtml(item.text)}</text>` : "").join("")}
      </svg>
      ${renderFeatureSummary(config)}
    </div>
  `;
}

export function renderMathGraphJsonBlock(configText: string): string {
  let config: MathGraphConfig;
  try {
    config = JSON.parse(configText);
  } catch (error) {
    return renderGraphError(`math-graph-json 解析失败：${error instanceof Error ? error.message : "JSON 格式错误"}`);
  }

  try {
    const type = String(config.graphType || "");
    if (["geometry_triangle", "geometry_quadrilateral", "geometry_circle"].includes(type)) {
      return renderGeometrySvg(config);
    }
    if (["function", "coordinate_geometry", "qualitative_curve", "conic_ellipse", "conic_hyperbola", "conic_parabola", "conic", "trigonometric"].includes(type)) {
      return renderCoordinateSvg(config);
    }
    return renderGraphCard(config, "当前图形类型暂不支持直接绘制，已保留结构化信息供教师确认");
  } catch (error) {
    return renderGraphError(`math-graph-json 渲染失败：${error instanceof Error ? error.message : "图形结构错误"}`);
  }
}

export function renderGraphBlock(configText: string): string {
  const config = parseGraphConfig(configText);
  const type = config.type || "quadratic";
  if (!["linear", "quadratic", "inverse", "power"].includes(type)) {
    return `<pre class="code-block">${escapeHtml(configText)}</pre>`;
  }

  const frame = svgFrame({
    title: config.title || config.expression || "函数图像",
    axes: {
      xMin: Number(config.xMin ?? -5),
      xMax: Number(config.xMax ?? 5),
      yMin: Number(config.yMin ?? -5),
      yMax: Number(config.yMax ?? 10),
    },
  });
  const paths: string[][] = [[]];

  for (let i = 0; i <= 160; i += 1) {
    const x = frame.xMin + ((frame.xMax - frame.xMin) * i) / 160;
    const y = graphValue(type, x);
    if (y === null || y < frame.yMin || y > frame.yMax) {
      if (paths.at(-1)?.length) paths.push([]);
      continue;
    }
    paths.at(-1)?.push(`${paths.at(-1)?.length ? "L" : "M"}${frame.sx(x).toFixed(2)},${frame.sy(y).toFixed(2)}`);
  }

  const keyPoints = (config.keyPoints || "")
    .split(";")
    .map((point) => point.split(",").map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  return `
    <div class="math-graph">
      <div class="math-graph-title">${escapeHtml(config.title || config.expression || "函数图像")}</div>
      <svg viewBox="0 0 ${frame.width} ${frame.height}" role="img" aria-label="${escapeHtml(config.title || "函数图像")}">
        ${renderAxes({}, frame)}
        ${paths.map((path) => `<path d="${path.join(" ")}" fill="none" stroke="#1683ff" stroke-width="2.4" stroke-linecap="round" />`).join("")}
        ${keyPoints.map(([x, y]) => `<circle cx="${frame.sx(x)}" cy="${frame.sy(y)}" r="3.5" fill="#1a9d6c" />`).join("")}
      </svg>
    </div>
  `;
}
