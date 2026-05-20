export function escapeHtml(value: unknown): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function splitBraceContent(source: string, startIndex: number): { value: string; end: number } | null {
  if (source[startIndex] !== "{") return null;
  let depth = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return { value: source.slice(startIndex + 1, index), end: index + 1 };
  }
  return null;
}

function readMathAtom(source: string, index: number): { value: string; end: number } {
  if (source[index] === "{") {
    const group = splitBraceContent(source, index);
    if (group) return group;
  }
  return { value: source[index] || "", end: index + 1 };
}

export function renderMathExpression(expression: string): string {
  const greek: Record<string, string> = {
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\theta": "θ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\pi": "π",
    "\\rho": "ρ",
    "\\sigma": "σ",
    "\\omega": "ω",
  };
  const symbols: Record<string, string> = {
    "\\times": "×",
    "\\cdot": "·",
    "\\le": "≤",
    "\\ge": "≥",
    "\\leq": "≤",
    "\\geq": "≥",
    "\\neq": "≠",
    "\\infty": "∞",
    "\\pm": "±",
    "\\Rightarrow": "⇒",
    "\\leftarrow": "←",
    "\\rightarrow": "→",
    "\\quad": " ",
  };
  let html = "";
  const source = String(expression || "").trim();

  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("\\frac", index)) {
      const numerator = splitBraceContent(source, index + 5);
      const denominator = numerator ? splitBraceContent(source, numerator.end) : null;
      if (numerator && denominator) {
        html += `<span class="frac"><span class="frac-num">${renderMathExpression(numerator.value)}</span><span class="frac-den">${renderMathExpression(denominator.value)}</span></span>`;
        index = denominator.end - 1;
        continue;
      }
    }

    if (source.startsWith("\\sqrt", index)) {
      let cursor = index + 5;
      let rootIndex = "";
      if (source[cursor] === "[") {
        const close = source.indexOf("]", cursor);
        if (close !== -1) {
          rootIndex = source.slice(cursor + 1, close);
          cursor = close + 1;
        }
      }
      const radicand = splitBraceContent(source, cursor);
      if (radicand) {
        html += `<span class="sqrt">${rootIndex ? `<span class="sqrt-index">${renderMathExpression(rootIndex)}</span>` : ""}<span>√</span><span class="sqrt-body">${renderMathExpression(radicand.value)}</span></span>`;
        index = radicand.end - 1;
        continue;
      }
    }

    if (source[index] === "^" || source[index] === "_") {
      const tag = source[index] === "^" ? "sup" : "sub";
      const atom = readMathAtom(source, index + 1);
      html += `<${tag}>${renderMathExpression(atom.value)}</${tag}>`;
      index = atom.end - 1;
      continue;
    }

    if (source[index] === "\\") {
      const match = source.slice(index).match(/^\\[A-Za-z]+/);
      if (match) {
        html += escapeHtml(greek[match[0]] || symbols[match[0]] || match[0].replace("\\", ""));
        index += match[0].length - 1;
        continue;
      }
    }

    html += escapeHtml(source[index]);
  }

  return html;
}

export function renderMathInline(math: string): string {
  return `<span class="math-inline">${renderMathExpression(math)}</span>`;
}

export function renderMathBlock(math: string): string {
  return `<div class="math-block">${renderMathExpression(math)}</div>`;
}
