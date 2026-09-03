/**
 * PKE Phase 4.2 — textual type-reference scan with fromType scope.
 */
import fs from "node:fs";
import path from "node:path";

export const SCAN_CAPS = {
  maxEdgesPerFile: 120,
  maxEdgesProject: 80_000,
};

const TYPE_DECL_LINE =
  /^\s*(?:public|internal|protected|private)?\s*(?:partial\s+)?(?:sealed\s+|abstract\s+|static\s+)*?(class|interface|struct|enum|record)\s+(\w+)/;

const WORD = /\b[A-Za-z_]\w*\b/g;

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Strip // comments, block comments, and string literals for scan. */
export function stripCodeForScan(text) {
  let out = "";
  let i = 0;
  let inLineComment = false;
  let inBlock = false;
  let inString = null;
  let verbatim = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += "\n";
      }
      i++;
      continue;
    }

    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 2;
        out += " ";
        continue;
      }
      if (ch === "\n") out += "\n";
      else out += " ";
      i++;
      continue;
    }

    if (inString) {
      if (verbatim) {
        if (ch === '"' && next === '"') {
          out += "  ";
          i += 2;
          continue;
        }
        if (ch === '"') {
          inString = null;
          verbatim = false;
          out += " ";
          i++;
          continue;
        }
        out += ch === "\n" ? "\n" : " ";
        i++;
        continue;
      }
      if (ch === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
        out += " ";
        i++;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === '"') {
      inString = '"';
      verbatim = i > 0 && text[i - 1] === "@";
      out += " ";
      i++;
      continue;
    }
    if (ch === "'") {
      inString = "'";
      out += " ";
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function isSkipLine(trimmed) {
  if (!trimmed) return true;
  if (/^\s*using\b/.test(trimmed)) return true;
  if (/^\s*namespace\b/.test(trimmed)) return true;
  if (/^\s*\[/.test(trimmed)) return true;
  if (/^\s*#/.test(trimmed)) return true;
  return false;
}

function declaringTypeOnLine(trimmed) {
  const m = trimmed.match(TYPE_DECL_LINE);
  return m?.[2] ?? null;
}

/**
 * Build type scope ranges with brace depth.
 * @returns {{ name: string, startLine: number, endLine: number }[]}
 */
export function buildTypeScopes(lines) {
  const scopes = [];
  const stack = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    const decl = trimmed.match(TYPE_DECL_LINE);
    if (decl) {
      stack.push({ name: decl[2], startLine: lineNo, depthAtStart: depth });
    }

    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth > 0) depth--;
        while (stack.length && stack[stack.length - 1].depthAtStart >= depth) {
          const top = stack.pop();
          scopes.push({ name: top.name, startLine: top.startLine, endLine: lineNo });
        }
      }
    }
  }

  while (stack.length) {
    const top = stack.pop();
    scopes.push({ name: top.name, startLine: top.startLine, endLine: lines.length });
  }

  return scopes;
}

export function enclosingType(lineNo, scopes, fallbackType) {
  let best = null;
  for (const s of scopes) {
    if (lineNo >= s.startLine && lineNo <= s.endLine) {
      if (!best || s.startLine >= best.startLine) best = s;
    }
  }
  return best?.name ?? fallbackType ?? null;
}

function loadFilePrimaryTypes(projectRoot) {
  const modulesDir = path.join(projectRoot, ".cursor", "codebase-index", "modules");
  const map = new Map();
  if (!fs.existsSync(modulesDir)) return map;

  for (const file of fs.readdirSync(modulesDir)) {
    if (!file.endsWith(".json")) continue;
    const mod = readJsonSafe(path.join(modulesDir, file));
    for (const t of mod?.types ?? []) {
      if (typeof t === "string") continue;
      if (t?.name && t?.file && !map.has(t.file)) map.set(t.file, t.name);
    }
  }
  return map;
}

function edgeKey(e) {
  return `${e.fromFile}|${e.line}|${e.toType}`;
}

/**
 * Scan one file for type-reference edges.
 */
export function scanFileForEdges(relFile, fullPath, typeSet, filePrimaryType) {
  const raw = fs.readFileSync(fullPath, "utf8");
  const stripped = stripCodeForScan(raw);
  const lines = stripped.split(/\r?\n/);
  const scopes = buildTypeScopes(lines);
  const edges = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    if (isSkipLine(trimmed)) continue;

    const declType = declaringTypeOnLine(trimmed);
    const fromType = enclosingType(lineNo, scopes, filePrimaryType);
    if (!fromType) continue;

    WORD.lastIndex = 0;
    let wm;
    while ((wm = WORD.exec(lines[i])) !== null) {
      const w = wm[0];
      if (!typeSet.has(w)) continue;
      if (declType === w) continue;
      if (fromType === w) continue;

      const edge = { fromFile: relFile, fromType, toType: w, line: lineNo };
      const key = edgeKey(edge);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(edge);
      if (edges.length >= SCAN_CAPS.maxEdgesPerFile) break;
    }
    if (edges.length >= SCAN_CAPS.maxEdgesPerFile) break;
  }

  return edges;
}

export function sortEdges(edges) {
  return [...edges].sort((a, b) => {
    const fc = a.fromFile.localeCompare(b.fromFile);
    if (fc !== 0) return fc;
    if (a.line !== b.line) return a.line - b.line;
    return a.toType.localeCompare(b.toType);
  });
}

export function buildSymbolShardsFromEdges(edges, maxSitesPerSymbol = 48) {
  const siteMap = new Map();
  for (const e of edges) {
    if (!siteMap.has(e.toType)) siteMap.set(e.toType, []);
    const list = siteMap.get(e.toType);
    if (list.length >= maxSitesPerSymbol) continue;
    const site = {
      file: e.fromFile,
      line: e.line,
      kind: "type",
      fromType: e.fromType,
    };
    const dup = list.some((s) => s.file === site.file && s.line === site.line);
    if (!dup) list.push(site);
  }
  return siteMap;
}
