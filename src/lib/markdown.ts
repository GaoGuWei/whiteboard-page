import katex from "katex";
import { renderGraphBlock, renderMathGraphJsonBlock } from "./graphPreview";
import { escapeHtml } from "./mathPreview";

export interface MarkdownPreviewResult {
  html: string;
  warnings: string[];
}

function looksLikeMarkdown(value: string): boolean {
  const source = String(value || "").trim();
  return (
    /^#{1,6}\s/m.test(source) ||
    /^\s*[-*]\s+/m.test(source) ||
    /^\s*\d+\.\s+/m.test(source) ||
    /\*\*[^*]+\*\*/.test(source) ||
    /\$\$[\s\S]+?\$\$/.test(source) ||
    /\\\(|\\\[|\$[^$\n]+?\$/.test(source) ||
    /^---+$/m.test(source)
  );
}

function normalizeMarkdownSource(markdown: string): string {
  let source = String(markdown || "").trim();
  for (let index = 0; index < 3; index += 1) {
    const fence = source.match(/^```([^\n`]*)\n([\s\S]*?)\n```\s*$/);
    if (!fence) break;
    const lang = fence[1].trim().toLowerCase();
    const body = fence[2].trim();
    if (lang && !["markdown", "md"].includes(lang)) break;
    if (!lang && !looksLikeMarkdown(body)) break;
    source = body;
  }
  return source;
}

function normalizeDisplayMath(markdown: string): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const normalized: string[] = [];
  let bracketMath: string[] | null = null;

  const pushTextBeforeMath = (text: string) => {
    const trimmed = text.replace(/\s+$/, "");
    if (trimmed) normalized.push(trimmed);
  };

  for (const rawLine of lines) {
    let line = rawLine;

    if (bracketMath) {
      const closeIndex = line.indexOf("\\]");
      if (closeIndex === -1) {
        bracketMath.push(line);
        continue;
      }

      bracketMath.push(line.slice(0, closeIndex));
      normalized.push("$$");
      normalized.push(bracketMath.join("\n").trim());
      normalized.push("$$");
      bracketMath = null;
      const rest = line.slice(closeIndex + 2).trim();
      if (rest) normalized.push(rest);
      continue;
    }

    const openIndex = line.indexOf("\\[");
    if (openIndex === -1) {
      normalized.push(line);
      continue;
    }

    const before = line.slice(0, openIndex);
    const afterOpen = line.slice(openIndex + 2);
    const closeIndex = afterOpen.indexOf("\\]");
    pushTextBeforeMath(before);

    if (closeIndex !== -1) {
      normalized.push("$$");
      normalized.push(afterOpen.slice(0, closeIndex).trim());
      normalized.push("$$");
      const rest = afterOpen.slice(closeIndex + 2).trim();
      if (rest) normalized.push(rest);
      continue;
    }

    bracketMath = [afterOpen];
  }

  if (bracketMath) {
    normalized.push("$$");
    normalized.push(bracketMath.join("\n").trim());
    normalized.push("$$");
  }

  return normalized.join("\n");
}

function renderKatex(math: string, displayMode: boolean, warnings: string[]): string {
  const source = String(math || "").trim();
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: "warn",
      trust: false,
    });
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : `公式无法渲染：${source}`);
    const className = displayMode ? "math-block math-render-error" : "math-inline math-render-error";
    return `<span class="${className}">${escapeHtml(source)}</span>`;
  }
}

function collectDelimiterWarnings(markdown: string, warnings: string[]) {
  const source = String(markdown || "");
  const singleDollarCount = (source.match(/(?<!\\)\$/g) || []).length - ((source.match(/(?<!\\)\$\$/g) || []).length * 2);
  if (singleDollarCount % 2 !== 0) warnings.push("存在未闭合的 $ 行内公式，请检查公式分隔符。");
  if ((source.match(/\\\(/g) || []).length !== (source.match(/\\\)/g) || []).length) warnings.push("存在未闭合的 \\( ... \\) 行内公式。");
  if ((source.match(/\\\[/g) || []).length !== (source.match(/\\\]/g) || []).length) warnings.push("存在未闭合的 \\[ ... \\] 块级公式。");
}

function renderInlineMarkdown(value: string, warnings: string[]): string {
  const placeholders: Array<[string, string]> = [];
  const stash = (html: string) => {
    const key = `@@MATH_${placeholders.length}@@`;
    placeholders.push([key, html]);
    return key;
  };

  let text = String(value || "")
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => stash(renderKatex(math, false, warnings)))
    .replace(/\$\$([^$\n]+?)\$\$/g, (_, math) => stash(renderKatex(math, false, warnings)))
    .replace(/\$([^$\n]+?)\$/g, (_, math) => stash(renderKatex(math, false, warnings)));
  text = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const [key, html] of placeholders) text = text.replaceAll(key, html);
  return text;
}

function renderCodeBlock(lang: string, source: string, depth: number, warnings: string[]): string {
  const cleanLang = String(lang || "").trim().toLowerCase();
  const body = source.replace(/\s+$/, "");
  if (cleanLang === "graph") return renderGraphBlock(body);
  if (cleanLang === "math-graph-json") return renderMathGraphJsonBlock(body);
  if (depth < 3 && (cleanLang === "markdown" || cleanLang === "md" || (!cleanLang && looksLikeMarkdown(body)))) {
    return buildMarkdownHtml(body, depth + 1, warnings);
  }
  return `<pre class="code-block">${escapeHtml(body)}</pre>`;
}

function buildMarkdownHtml(markdown: string, depth = 0, warnings: string[] = []): string {
  const source = normalizeDisplayMath(normalizeMarkdownSource(markdown));
  if (depth === 0) collectDelimiterWarnings(source, warnings);
  const lines = source.split(/\r?\n/);
  const html: string[] = [];
  let listOpen = false;
  let mathBlock: string[] | null = null;
  let codeBlock: { lang: string; lines: string[] } | null = null;

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (mathBlock) {
      if (line === "$$") {
        html.push(renderKatex(mathBlock.join("\n"), true, warnings));
        mathBlock = null;
      } else mathBlock.push(rawLine);
      continue;
    }

    if (codeBlock) {
      if (line === "```") {
        closeList();
        html.push(renderCodeBlock(codeBlock.lang, codeBlock.lines.join("\n"), depth, warnings));
        codeBlock = null;
      } else codeBlock.lines.push(rawLine);
      continue;
    }

    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith("$$") && line.endsWith("$$") && line.length > 4) {
      closeList();
      html.push(renderKatex(line.slice(2, -2), true, warnings));
    } else if (line === "$$") {
      closeList();
      mathBlock = [];
    } else if (line.startsWith("```")) {
      closeList();
      codeBlock = { lang: line.slice(3).trim().toLowerCase(), lines: [] };
    } else if (/^-{3,}$/.test(line)) {
      closeList();
      html.push("<hr />");
    } else if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${renderInlineMarkdown(line.slice(4), warnings)}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${renderInlineMarkdown(line.slice(3), warnings)}</h2>`);
    } else if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${renderInlineMarkdown(line.slice(2), warnings)}</h1>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ""), warnings)}</li>`);
    } else {
      closeList();
      html.push(`<p>${renderInlineMarkdown(line, warnings)}</p>`);
    }
  }

  closeList();
  if (mathBlock) html.push(renderKatex(mathBlock.join("\n"), true, warnings));
  if (codeBlock) html.push(renderCodeBlock(codeBlock.lang, codeBlock.lines.join("\n"), depth, warnings));
  return html.join("");
}

export function renderMarkdownPreviewWithWarnings(markdown: string): MarkdownPreviewResult {
  const warnings: string[] = [];
  const html = buildMarkdownHtml(markdown, 0, warnings) || "<p>暂无可预览内容。</p>";
  return {
    html,
    warnings: Array.from(new Set(warnings)),
  };
}

export function renderMarkdownPreview(markdown: string): string {
  return renderMarkdownPreviewWithWarnings(markdown).html;
}
