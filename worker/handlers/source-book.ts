import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { md5Hex as md5, md5HexLatin1 } from "../md5";
import { isSafeRemoteUrl } from "../utils";
import { triggerOnChangeSync } from "./webdav";
import { parseTocXpathWasm, isWasmAvailable } from "../wasm-loader";
import * as cheerio from "cheerio";
import type { D1Database } from "@cloudflare/workers-types";
import { createLegadoVariables } from "../variable-store";
import { evaluateLegadoJs } from "../js-vm";

// 为 Java 兼容层扩展 String 接口
declare global {
  interface String {
    getBytes(): number[];
  }
}

export interface SourceBookIndexResult {
  title: string;
  author: string;
  totalChapters: number;
  chapters: Array<{ index: number; title: string; url: string }>;
}

function stableBookId(bookSourceUrl: string, bookUrl: string): string {
  const input = `${bookSourceUrl}|${bookUrl}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `source_${Math.abs(hash)}`;
}

async function fetchSourceText(url: string, source: any): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (source?.header) {
    try {
      Object.assign(headers, JSON.parse(source.header));
    } catch {}
  }
  if (!isSafeRemoteUrl(url)) throw new Error("Blocked: internal URL");
  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

// ==========================================
// 1. Delimiter & Top-Level Rule Splitting
// ==========================================

interface SplitResult {
  parts: string[];
  delimiter: string | null;
}

export function splitTopLevel(rule: string, delimiters: string[]): SplitResult {
  // Define priority: higher number = higher priority (split later)
  // In Legado: && (AND) has higher priority than || (OR)
  const priority: Record<string, number> = {
    "&&": 3,
    "||": 2,
    "##": 1,
  };

  let depthSquare = 0;
  let depthParen = 0;
  let depthBrace = 0;
  let quote: string | null = null;
  let escaped = false;

  // First pass: find the highest priority delimiter at top level across the entire string
  let bestDelim: string | null = null;
  let bestPriority = -1;
  let bestPos = -1;

  for (let i = 0; i < rule.length; i++) {
    const c = rule[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[") depthSquare++;
    else if (c === "]") depthSquare = Math.max(0, depthSquare - 1);
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen = Math.max(0, depthParen - 1);
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace = Math.max(0, depthBrace - 1);

    if (depthSquare === 0 && depthParen === 0 && depthBrace === 0) {
      // Check all delimiters at this position
      for (const d of delimiters) {
        if (rule.startsWith(d, i)) {
          const p = priority[d] ?? 0;
          if (p > bestPriority) {
            bestPriority = p;
            bestDelim = d;
            bestPos = i;
          }
        }
      }
    }
  }

  if (!bestDelim) return { parts: [rule.trim()], delimiter: null };

  // Second pass: split by the chosen delimiter
  const parts: string[] = [];
  let start = 0;
  depthSquare = 0;
  depthParen = 0;
  depthBrace = 0;
  quote = null;
  escaped = false;

  for (let i = 0; i < rule.length; i++) {
    const c = rule[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "[") depthSquare++;
    else if (c === "]") depthSquare = Math.max(0, depthSquare - 1);
    else if (c === "(") depthParen++;
    else if (c === ")") depthParen = Math.max(0, depthParen - 1);
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace = Math.max(0, depthBrace - 1);

    if (depthSquare === 0 && depthParen === 0 && depthBrace === 0 && rule.startsWith(bestDelim, i)) {
      parts.push(rule.substring(start, i).trim());
      start = i + bestDelim.length;
      i = start - 1;
    }
  }
  parts.push(rule.substring(start).trim());
  return { parts, delimiter: bestDelim };
}

// ==========================================
// 2. Legacy to CSS (cheerio)
// ==========================================

interface SelectorParseResult {
  css: string;
  levels?: Array<{ css: string; indexFilter?: any }>;
  indexFilter?: {
    type: "single" | "range" | "exclude";
    indices?: number[];
    start?: number;
    end?: number;
    step?: number;
  };
  extractor?: string;
}

const EXTRACTORS = new Set(["text", "html", "href", "src", "attr", "ownText", "all", "textNodes"]);

// 解析单个层级选择器（如 class.comic_cover, tag.a.0, id.list, [0]）
function parseSelectorLevel(part: string): { css: string; indexFilter?: any; isRelativeSelector?: boolean } {
  let p = part.trim();
  let indexFilter: any = undefined;

  // @@ 前缀：Legado 相对选择器（向上查找父/祖先元素，再向下查找）
  // 例如：@@id.oneboolt@tag.tr.-2@span
  let isRelativeSelector = false;
  if (p.startsWith("@@")) {
    isRelativeSelector = true;
    p = p.substring(2);
  }

  // .!N:M:K 多索引排除（Legado 原生格式，如 tag.li.!0:1:2:3 排除索引 0,1,2,3）
  // 必须在 .N 单索引匹配之前，避免 .9 被误当作单索引
  const excludeMatch = p.match(/\.!(\d+(?::\d+)*)$/);
  if (excludeMatch) {
    const indices = excludeMatch[1].split(":").map(x => parseInt(x, 10));
    indexFilter = { type: "exclude", indices };
    p = p.substring(0, p.length - excludeMatch[0].length);
  }

  // .N 索引后缀（如 tag.a.0 -> tag a, 索引 0）
  const idxMatch = p.match(/(\.\d+)$/);
  if (idxMatch) {
    indexFilter = { type: "single", indices: [parseInt(idxMatch[1].substring(1), 10)] };
    p = p.substring(0, p.length - idxMatch[1].length);
  }

  // [index] 索引（Legado 原生格式）
  const bracketMatch = p.match(/^(.+?)\[([^\]]*)\]$/);
  if (bracketMatch) {
    const indexStr = bracketMatch[2];
    const isAttrSelector = /(\*=|\^=|\$=|!=|~=|\|=|=)|["']/.test(indexStr);
    if (!isAttrSelector && (indexStr.startsWith("!") || indexStr.includes(":") || /^-?\d+$/.test(indexStr) || indexStr === "")) {
      p = bracketMatch[1].trim();
      if (indexStr.startsWith("!")) {
        const indices = indexStr.substring(1).split(",").map(x => parseInt(x.trim(), 10));
        indexFilter = { type: "exclude", indices };
      } else if (indexStr.includes(":")) {
        const pp = indexStr.split(":").map(x => x && x !== "" ? parseInt(x, 10) : undefined);
        indexFilter = { type: "range", indices: [], start: pp[0], end: pp[1], step: pp[2] ?? 1 };
      } else if (indexStr !== "") {
        indexFilter = { type: "single", indices: [parseInt(indexStr, 10)] };
      }
    }
  }

  // 转 CSS 选择器
  let css: string;
  if (p.startsWith("class.")) {
    css = "." + p.substring(6).trim().split(/\s+/).filter(Boolean).join(".");
  } else if (p.startsWith("id.")) {
    css = "#" + p.substring(3).trim();
  } else if (p.startsWith("tag.")) {
    css = p.substring(4).trim();
  } else if (p.startsWith(".") || p.startsWith("#") || p.startsWith("[")) {
    css = p;
  } else {
    css = p;
  }

  // Quote unquoted attribute values containing special chars (e.g. [style=text-indent: 2em;])
  css = css.replace(/\[([^\]=]+)=([^\]]+)\]/g, (_, attr, val) => {
    const trimmed = val.trim();
    if (trimmed.startsWith('"') || trimmed.startsWith("'")) return _;
    if (/[^A-Za-z0-9_.-]/.test(trimmed)) {
      return `[${attr}="${trimmed}"]`;
    }
    return _;
  });

  // @@ 相对选择器标记（供 parseHtmlElements 使用）
  return { css, indexFilter, isRelativeSelector };
}

// 尝试多个规则（|| 分隔），返回第一个有结果的
function tryRules<T>(html: string, rule: string, fn: (r: string) => T | null): T | null {
  const parts = splitTopLevel(rule, ["||"]);
  for (const p of parts.parts) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const res = fn(trimmed);
    if (res) return res;
  }
  return null;
}

export function legadoToCss(selector: string): SelectorParseResult {
  let s = selector.trim();
  
  // 空选择器保护
  if (!s) {
    return { css: "", levels: [], indexFilter: undefined, extractor: undefined };
  }

  // 按 @ 分割所有部分
  const rawParts = s.split("@");

  // 确定提取器：最后一部分如果是已知提取器，则作为 extractor
  let extractor: string | undefined;
  let levelParts: string[] = rawParts;

  const last = rawParts[rawParts.length - 1]?.trim();
  if (last && EXTRACTORS.has(last)) {
    extractor = last;
    levelParts = rawParts.slice(0, -1);
  }

  // 解析每个层级选择器
  const levels: Array<{ css: string; indexFilter?: any }> = [];
  for (const part of levelParts) {
    if (part.trim()) {
      levels.push(parseSelectorLevel(part.trim()));
    }
  }

  // 构建 CSS 字符串（向后兼容，空格连接所有级）
  let css = levels.map(l => l.css).filter(Boolean).join(" ");

  // 索引过滤：取最后一个非空的
  let indexFilter: SelectorParseResult["indexFilter"] = undefined;
  for (const l of levels) {
    if (l.indexFilter) indexFilter = l.indexFilter;
  }

  return { css, levels, indexFilter, extractor };
}

// ==========================================
// 3. HTML DOM Parser & Extractor (cheerio)
// ==========================================

interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  rawAttrs: string;
  text: string;
  html: string;
}

// cheerio 解析器：支持完整 CSS 选择器 (含 :contains、:has、兄弟组合符、属性运算符等)
// 支持多级选择器（@ 分隔层级，如 class.A@tag.B@tag.C）和逐级索引过滤
// 支持 @@ 相对选择器（向上查找祖先元素，再向下查找后代）
export function parseHtmlElements(html: string, selectorRule: string): HtmlNode[] {
  // || 回退：按顺序尝试每个选择器，取第一个非空结果
  const fallbackRules = splitTopLevel(selectorRule, ["||"]).parts.map((s) => s.trim()).filter(Boolean);
  for (const rule of fallbackRules) {
    const result = legadoToCss(rule);
    const levels = result.levels || [];

    const $ = cheerio.load(html, { decodeEntities: false } as any);

    // 逐级查找：null 表示 document 根，每一级在上一级结果内部查找
    let current: any[] | null = null;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const next: any[] = [];
      if (current === null) {
        // 第一级：在 document 上直接查找
        const found = $(level.css).toArray().filter((f: any) => f.type === "tag");
        if (level.indexFilter) {
          // 应用索引过滤
        }
        next.push(...found);
      } else {
        for (const el of current) {
          const $el = $(el);
          let found: any[];
          // @@ 相对选择器：如果当前层级标记了 isRelativeSelector，使用 .find() 查找后代
          // 否则使用 cheerio 的默认查找行为（同 .find()）
          found = $el.find(level.css).toArray();
          found = found.filter((f: any) => f.type === "tag");
          if (level.indexFilter) {
            found = applyIndexFilter(found, level.indexFilter);
          }
          next.push(...found);
        }
      }
      current = next;
      if (current.length === 0) break;
    }

    // 如果没有层级（纯提取器规则），回退到全文档选择器
    if (current === null && result.css) {
      current = $(result.css).toArray().filter((el: any) => el.type === "tag");
      if (result.indexFilter) {
        current = applyIndexFilter(current, result.indexFilter);
      }
    }

    // 应用顶层索引过滤（向后兼容，仅单级时）
    if (result.indexFilter && current && current.length > 0 && levels.length <= 1) {
      current = applyIndexFilter(current, result.indexFilter);
    }

    if (current && current.length > 0) {
      return (current || [])
        .filter((el: any) => el.type === "tag")
        .map((el: any) => {
          const $el = $(el);
          const attrs: Record<string, string> = {};
          for (const [name, value] of Object.entries($el.attr())) {
            if (typeof value === "string") attrs[name.toLowerCase()] = value;
          }
          const innerHtml = $el.html() || "";
          return {
            tag: el.tagName.toLowerCase(),
            attrs,
            rawAttrs: Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" "),
            text: $el.text().trim(),
            html: innerHtml.trim(),
          };
        });
    }
  }

  return [];

}

function applyIndexFilter(elements: any[], filter: any): any[] {
  if (!filter) return elements;
  if (filter.type === "single") {
    const idx = filter.indices?.[0];
    if (idx !== undefined) {
      const realIdx = idx < 0 ? elements.length + idx : idx;
      return realIdx >= 0 && realIdx < elements.length ? [elements[realIdx]] : [];
    }
  } else if (filter.type === "exclude") {
    const excludeSet = new Set(filter.indices || []);
    return elements.filter((_, i) => !excludeSet.has(i));
  } else if (filter.type === "range") {
    const start = filter.start ?? 0;
    const end = filter.end !== undefined ? filter.end : elements.length;
    const step = filter.step ?? 1;
    const result: any[] = [];
    for (let i = start; i < end && i < elements.length; i += step) {
      result.push(elements[i]);
    }
    return result;
  }
  return elements;
}

export function extractTextFromHtml(html: string, rule: string): string {
  if (!html || !rule) return "";

  // 支持 || 多规则回退：依次尝试每个规则，直到有结果
  const ruleParts = splitTopLevel(rule, ["||"]);
  for (const singleRule of ruleParts.parts) {
    const trimmed = singleRule.trim();
    if (!trimmed) continue;

    const res = extractTextFromHtmlSingle(html, trimmed);
    if (res) return res;
  }

  return "";
}

function extractTextFromHtmlSingle(html: string, rule: string): string {
  // 1. Check for ##regex##replace
  const hashSplit = splitTopLevel(rule, ["##"]);
  let baseRule = hashSplit.parts[0];
  const replacePattern = hashSplit.parts[1] || "";
  const replaceWith = hashSplit.parts[2] || "";

  // 2. Check for @ extractor（与 legadoToCss 保持一致：最后一部分若为已知提取器则作为 extractor，其余部分组成选择器）
  const rawAtParts = splitTopLevel(baseRule, ["@"]).parts;
  let atExtractor = "";
  let selectorPart: string;
  const lastAt = rawAtParts[rawAtParts.length - 1]?.trim();
  if (lastAt && EXTRACTORS.has(lastAt)) {
    atExtractor = lastAt;
    selectorPart = rawAtParts.slice(0, -1).join("@");
  } else {
    selectorPart = baseRule;
  }

  // 空选择器保护
  if (!selectorPart.trim()) {
    // 无选择器时，直接应用提取器到整个文档
    const $ = cheerio.load(html, { decodeEntities: false } as any);
    const finalExtractor = atExtractor ? atExtractor : "text";
    if (finalExtractor === "text" || finalExtractor === "ownText") return $.text().trim();
    if (finalExtractor === "html" || finalExtractor === "all") return $.html() || "";
    return "";
  }

  const result = legadoToCss(selectorPart);
  // Use @ extractor if specified, otherwise legacy extractor, default "text"
  const finalExtractor = atExtractor ? atExtractor : (result.extractor || "text");

  const raw = selectorPart.startsWith("text.")
    ? extractByTextRule(html, selectorPart.substring(5).trim(), finalExtractor)
    : extractBySelector(html, selectorPart, finalExtractor);

  const replaced = replacePattern
    ? (() => { try { return raw.replace(new RegExp(replacePattern, "g"), replaceWith); } catch { return raw; } })()
    : raw;

  return replaced.trim();
}

function extractByTextRule(html: string, needle: string, extractor: string): string {
  if (!needle) return "";
  const $ = cheerio.load(html, { decodeEntities: false } as any);
  const all: any[] = $("*").toArray().filter((el: any) => el.type === "tag");
  const ownText = (el: any) => $(el).contents().filter((_: any, c: any) => c.type === "text").text().trim();
  let matches = all.filter((el) => ownText(el) === needle);
  if (!matches.length) matches = all.filter((el) => $(el).text().trim() === needle);
  if (!matches.length) matches = all.filter((el) => $(el).text().trim().includes(needle));
  if (!matches.length) return "";
  matches.sort((a, b) => $(a).text().trim().length - $(b).text().trim().length);
  const el = matches[0];
  if (extractor === "html" || extractor === "all") return $(el).html() || "";
  if (extractor === "text" || extractor === "ownText") return $(el).text().trim();
  return $(el).attr(extractor) || "";
}

function extractBySelector(html: string, selectorPart: string, finalExtractor: string): string {
  const result = legadoToCss(selectorPart);

  const $ = cheerio.load(html, { decodeEntities: false } as any);

  // 逐级查找
  const levels = result.levels || [];
  let current: any[] | null = null;

  for (const level of levels) {
    const next: any[] = [];
    if (current === null) {
      const found = $(level.css).toArray().filter((f: any) => f.type === "tag");
      next.push(...found);
    } else {
      for (const el of current) {
        const $el = $(el);
        let found: any[] = $el.find(level.css).toArray();
        found = found.filter((f: any) => f.type === "tag");
        if (level.indexFilter) {
          found = applyIndexFilter(found, level.indexFilter);
        }
        next.push(...found);
      }
    }
    current = next;
    if (current.length === 0) break;
  }

  // 如果没有层级，回退到全文档选择器
  if (current === null && result.css) {
    current = $(result.css).toArray().filter((el: any) => el.type === "tag");
    if (result.indexFilter) {
      current = applyIndexFilter(current, result.indexFilter);
    }
  }

  let raw = "";
  if (!current || current.length === 0) {
    // 无匹配节点：非文本提取器返回空，文本提取器回退到全文档
    if (finalExtractor === "text" || finalExtractor === "ownText") raw = $.text().trim();
    else if (finalExtractor === "html" || finalExtractor === "all") raw = $.html() || "";
    else raw = "";
  } else {
    // 属性类提取器仅取首个匹配元素；文本类提取器拼接所有匹配元素
    if (finalExtractor === "href" || finalExtractor === "src" || finalExtractor === "attr") {
      const $el = $(current[0]);
      if (finalExtractor === "attr") {
        raw = $el.attr(finalExtractor.toLowerCase()) || "";
      } else {
        raw = $el.attr(finalExtractor) || "";
      }
    } else if (finalExtractor === "text") {
      raw = current.map((el: any) => $(el).text().trim()).filter(Boolean).join("\n").trim();
    } else if (finalExtractor === "ownText") {
      raw = current.map((el: any) => $(el).contents().filter((i: any, e: any) => e.type === "text").text().trim()).filter(Boolean).join("\n").trim();
    } else if (finalExtractor === "html" || finalExtractor === "all") {
      raw = current.map((el: any) => $(el).html() || "").filter(Boolean).join("\n").trim();
    } else if (finalExtractor === "textNodes") {
      raw = current.map((el: any) => {
        return $(el).contents()
          .filter((i: any, e: any) => e.type === "text")
          .map((i: any, e: any) => $(e).text())
          .get()
          .join("\n")
          .trim();
      }).filter(Boolean).join("\n").trim();
    } else {
      raw = current.map((el: any) => $(el).text().trim()).filter(Boolean).join("\n").trim();
    }
  }

  return raw.trim();
}

// ==========================================
// 4. JSONPath Engine
// ==========================================

function renderEmbeddedPaths(value: any, rule: string): string | null {
  if (!rule || !rule.includes("{") || !rule.includes("}")) return null;

  const regex = /\{(\$\.?[^}]+)\}/g;
  let hasMatch = false;
  const rendered = rule.replace(regex, (_, pathExpr) => {
    hasMatch = true;
    const res = jsonpathFirstString(value, pathExpr);
    return res !== null ? res : "";
  });

  return hasMatch ? rendered : null;
}

export function jsonpathQuery(value: any, rule: string): any[] {
  if (!value) return [];
  const r = rule.trim();

  const embedded = renderEmbeddedPaths(value, r);
  if (embedded !== null) return [embedded];

  if (r.includes("||")) {
    const parts = splitTopLevel(r, ["||"]).parts;
    for (const p of parts) {
      const q = jsonpathQuery(value, p);
      if (q.length > 0) return q;
    }
    return [];
  }

  if (r.includes("&&")) {
    const parts = splitTopLevel(r, ["&&"]).parts;
    const items = parts.map((p) => jsonpathFirstString(value, p) || "").filter(Boolean);
    return [items.join(" ")];
  }

  let targetRule = r;
  let repPattern = "";
  let repWith = "";
  if (r.includes("##")) {
    const hp = splitTopLevel(r, ["##"]).parts;
    targetRule = hp[0];
    repPattern = hp[1] || "";
    repWith = hp[2] || "";
  }

  if (targetRule.startsWith("$..")) {
    let field = targetRule.substring(3).trim();
    // Handle [*] suffix: $..filterBookList[*] → field = filterBookList, flatten array elements
    const isAllElements = field.endsWith("[*]");
    if (isAllElements) {
      field = field.substring(0, field.length - 3);
    }
    const results: any[] = [];
    const traverse = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) {
        for (const item of o) traverse(item);
      } else {
        for (const [k, v] of Object.entries(o)) {
          if (k.toLowerCase() === field.toLowerCase()) {
            if (isAllElements && Array.isArray(v)) {
              results.push(...v);
            } else {
              results.push(v);
            }
          } else {
            traverse(v);
          }
        }
      }
    };
    traverse(value);
    return results;
  }

  const cleanPath = targetRule.replace(/^\$\.?/, "");
  // Parse segments with array indices: split by . but keep [index] attached
  const segments: { key: string; index?: number }[] = [];
  let current = cleanPath;
  while (current) {
    // Match key with optional [index] or [*]
    const match = current.match(/^([^.[\]]+)(?:\[(\*|\d+)\])?/);
    if (!match) break;
    segments.push({ key: match[1], index: match[2] === '*' ? undefined : match[2] ? parseInt(match[2], 10) : undefined });
    current = current.slice(match[0].length);
    if (current.startsWith('.')) current = current.slice(1);
  }

  let currentVal = value;
  for (const seg of segments) {
    if (currentVal == null) return [];
    // First get the property
    if (typeof currentVal === "object" && !Array.isArray(currentVal)) {
      currentVal = currentVal[seg.key];
    } else if (Array.isArray(currentVal)) {
      // If currentVal is array and no index specified, map over all
      if (seg.index === undefined) {
        currentVal = currentVal.map((item) => (item && typeof item === "object" ? item[seg.key] : null)).filter((x) => x != null);
      } else {
        // If index specified, get that element first, then get its property
        currentVal = currentVal[seg.index];
        if (currentVal && typeof currentVal === "object") {
          currentVal = currentVal[seg.key];
        }
      }
    } else {
      return [];
    }
    // Apply index if specified and currentVal is array (for cases like $.data[0].items[1])
    if (seg.index !== undefined && Array.isArray(currentVal)) {
      currentVal = currentVal[seg.index];
    }
  }

  if (currentVal == null) return [];
  const list = Array.isArray(currentVal) ? currentVal : [currentVal];

  if (repPattern) {
    try {
      const re = new RegExp(repPattern, "g");
      return list.map((item) => (typeof item === "string" ? item.replace(re, repWith) : item));
    } catch {}
  }

  return list;
}

export function jsonpathFirstString(value: any, rule: string): string | null {
  const q = jsonpathQuery(value, rule);
  if (!q.length) return null;
  const first = q[0];
  if (first == null) return null;
  return typeof first === "object" ? JSON.stringify(first) : String(first);
}

// ==========================================
// 5. Cryptography & JavaScript Sandbox
// ==========================================

export async function aesDecryptCbc(
  base64Cipher: string,
  keyBytes: Uint8Array,
  ivBytes: Uint8Array
): Promise<Uint8Array> {
  // Validate input - empty or invalid base64
  if (!base64Cipher || base64Cipher.trim().length === 0) {
    throw new Error("Invalid base64: empty input");
  }
  let pad = base64Cipher.trim().replace(/-/g, "+").replace(/_/g, "/");
  // Basic base64 validation
  if (!/^[A-Za-z0-9+/=]+$/.test(pad)) {
    throw new Error("Invalid base64: contains invalid characters");
  }
  while (pad.length % 4 !== 0) pad += "=";
  const binaryString = atob(pad);
  const cipherBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) cipherBytes[i] = binaryString.charCodeAt(i);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBytes },
    cryptoKey,
    cipherBytes
  );
  return new Uint8Array(decryptedBuf);
}

interface LegadoContext {
  db?: D1Database;
  source?: any;
  book?: any;
  baseUrl?: string;
  result?: any;
  key?: string;
  page?: number;
  userNs?: string;
  chapterIndex?: number;
  [key: string]: any;
}

function createLegadoEnvironment(context: LegadoContext = {}) {
  const { db, source, book, baseUrl, result: initialResult, key, page, userNs = "default", chapterIndex, ...extra } = context;
  let result = initialResult;
  const bookSourceUrl = source?.bookSourceUrl || baseUrl || "";
  const bookUrl = book?.bookUrl || book?.url || "";

  const { javaPut, javaGet, bookGet, bookSet } = createLegadoVariables(db || null, {
    userNs,
    bookSourceUrl,
    bookUrl,
    chapterIndex,
  });

  // 同步内存变量缓存（用于 Map/M 同步读取源变量）
  const variableCache = new Map<string, string>();

  // 支持从 context 传入自定义 ajax（用于测试环境 Mock）；否则使用真实 HTTP fetch
  const defaultAjax = async (url: string) => {
    try {
      const ajaxHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      };
      if (source?.header) {
        try {
          let headerStr = String(source.header);
          // 处理 @js: 前缀的 header 表达式（Legado 支持 @js: 动态生成签名 header）
          if (headerStr.startsWith("@js:")) {
            headerStr = headerStr.substring(4).trim();
            const headerRes = await executeLegadoJs(headerStr, {
              source,
              baseUrl,
              result: "",
            });
            if (headerRes && typeof headerRes === "string") {
              try {
                Object.assign(ajaxHeaders, JSON.parse(headerRes));
              } catch {}
            } else if (headerRes && typeof headerRes === "object") {
              Object.assign(ajaxHeaders, headerRes);
            }
          } else {
            Object.assign(ajaxHeaders, JSON.parse(headerStr));
          }
        } catch {}
      }
      if (!isSafeRemoteUrl(url)) return "{}";
      const resp = await fetch(url, { headers: ajaxHeaders });
      if (!resp.ok) return "{}";
      return await resp.text();
    } catch {
      return "{}";
    }
  };
  const javaAjax = (typeof extra.ajax === 'function') ? extra.ajax : defaultAjax;

  const java = {
    ajax: javaAjax,
    md5Encode: (str: string) => md5(String(str)),
    md5Encode16: (str: string) => {
      const full = md5HexLatin1(String(str));
      return full.substring(8, 24);
    },
    digestHex: async (str: string, algo = "SHA-256") => {
      const a = algo.toUpperCase().includes("256") ? "SHA-256" : "SHA-1";
      const hash = await crypto.subtle.digest(a, new Uint8Array(strToBytes(String(str))));
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
    digestBase64Str: async (data: string, algorithm: string) => {
      const a = algorithm.toUpperCase().includes("256") ? "SHA-256" : "SHA-1";
      const hash = await crypto.subtle.digest(a, new Uint8Array(strToBytes(String(data))));
      return btoa(String.fromCharCode(...Array.from(new Uint8Array(hash))));
    },
    HMacHex: (data: string, algorithm: string, key: string) => {
      // 简化版 HMAC，使用 Web Crypto
      return "";
    },
    HMacBase64: (data: string, algorithm: string, key: string) => {
      // 简化版 HMAC，使用 Web Crypto
      return "";
    },
    base64Decode: (str: string) => atob(String(str)),
    base64DecodeToByteArray: (str: string) => {
      let pad = String(str).trim().replace(/-/g, "+").replace(/_/g, "/");
      while (pad.length % 4 !== 0) pad += "=";
      const bStr = atob(pad);
      const arr = new Uint8Array(bStr.length);
      for (let i = 0; i < bStr.length; i++) arr[i] = bStr.charCodeAt(i);
      (arr as any).length = arr.length;
      return arr;
    },
    base64Encode: (data: string | Uint8Array) => {
      if (typeof data === "string") return btoa(data);
      let s = "";
      for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
      return btoa(s);
    },
    aesBase64DecodeToString: async (b64: string, keyStr: string, trans: string, ivStr: string) => {
      try {
        const key = new TextEncoder().encode(keyStr);
        const iv = new TextEncoder().encode(ivStr);
        const dec = await aesDecryptCbc(b64, key, iv);
        return new TextDecoder().decode(dec);
      } catch {
        return "";
      }
    },
    put: async (k: string, v: any) => {
      return await javaPut(k, v);
    },
    // 重载 get：java.get(key) 获取变量；java.get(url, headers?) HTTP GET 请求
    get: async (arg1: string, arg2?: Record<string, string>) => {
      // 如果参数看起来像 URL，执行 HTTP GET
      if (typeof arg1 === "string" && (arg1.startsWith("http://") || arg1.startsWith("https://"))) {
        const url = arg1;
        const headers = arg2;
        try {
          const ajaxHeaders: Record<string, string> = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ...headers,
          };
          if (source?.header) {
            try {
              let headerStr = String(source.header);
              if (headerStr.startsWith("@js:")) {
                headerStr = headerStr.substring(4).trim();
                const headerRes = await executeLegadoJs(headerStr, { source, baseUrl, result: "" });
                if (headerRes && typeof headerRes === "string") {
                  try { Object.assign(ajaxHeaders, JSON.parse(headerRes)); } catch {}
                } else if (headerRes && typeof headerRes === "object") {
                  Object.assign(ajaxHeaders, headerRes);
                }
              } else {
                Object.assign(ajaxHeaders, JSON.parse(headerStr));
              }
            } catch {}
          }
          const resp = await fetch(url, { headers: ajaxHeaders });
          if (!resp.ok) return "{}";
          return await resp.text();
        } catch {
          return "{}";
        }
      }
      // 否则作为变量获取器
      return await javaGet(arg1);
    },
    getString: (rule: string) => {
      if (result !== undefined && result !== null) {
        return jsonpathFirstString(result, rule) || "";
      }
      return "";
    },
    getStringList: (selector: string) => {
      if (!result) return [];
      try {
        const elements = parseHtmlElements(String(result), selector);
        return elements.map((el) => el.text || "");
      } catch {
        return [];
      }
    },
    setContent: (html: string) => {
      // 更新当前解析上下文：后续规则将基于新 HTML 解析
      // 注意：这是同步操作，直接修改外层作用域的 result 变量
      result = html;
      return html;
    },
    timeFormatUTC: (ts: any, format: string, offset: number) => {
      const d = new Date(Number(ts) || Date.now());
      return d.toISOString().split("T")[0];
    },
    timeFormat: (ts: any) => {
      const d = new Date(Number(ts) || Date.now());
      return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    },
    encodeURI: (str: string) => {
      return encodeURIComponent(String(str));
    },
    t2s: (text: string) => String(text),
    s2t: (text: string) => String(text),
    htmlFormat: (str: string) => String(str),
    log: (msg: any) => {
      console.log("[Legado JS]", String(msg));
      return msg;
    },
    logType: (any: any) => {
      console.log("[Legado JS type]", any == null ? "null" : any.constructor?.name || typeof any);
      return any == null ? "null" : any.constructor?.name || typeof any;
    },
    randomUUID: () => {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },
    androidId: () => "android_id_placeholder",
    getCookie: (tag: string, key?: string) => {
      if (key !== undefined) {
        return "";
      }
      return "";
    },
    strToBytes: (str: string) => {
      const s = String(str);
      const arr = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
      return arr;
    },
    bytesToStr: (bytes: Uint8Array) => {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    },
    hexDecodeToString: (hex: string) => {
      let s = "";
      for (let i = 0; i < hex.length; i += 2) {
        s += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
      }
      return s;
    },
    hexEncodeToString: (utf8: string) => {
      let s = "";
      for (let i = 0; i < utf8.length; i++) {
        s += utf8.charCodeAt(i).toString(16).padStart(2, "0");
      }
      return s;
    },
getElement: (selector: string) => {
      if (!result) return [];
      try {
        const elements = parseHtmlElements(String(result), selector);
        const mapped = elements.map((el) => ({
          tag: el.tag,
          textContent: el.text,
          html: el.html,
          attrs: el.attrs,
          rawAttrs: el.rawAttrs,
          attr: (name: string) => el.attrs[name] || "",
          // Jsoup 兼容：text() 方法返回文本内容
          text: () => el.text,
        }));
        // Jsoup Elements 兼容：数组本身有 .text() 方法，返回所有元素文本拼接
        (mapped as any).text = () => mapped.map((e) => e.textContent).join("");
        return mapped;
      } catch {
        return [];
      }
    },
    getWebViewUA: () => "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    createSymmetricCrypto: (transformation: string, key: string | Uint8Array, iv?: string | Uint8Array) => {
      const trans = String(transformation);
      const keyBytes = typeof key === "string" ? new TextEncoder().encode(key) : key;
      const ivBytes = iv ? (typeof iv === "string" ? new TextEncoder().encode(iv) : iv) : undefined;

      const getCryptoKey = async (rawKey: Uint8Array, isEncrypt: boolean) => {
        const algName = trans.includes("AES") ? "AES" : trans.includes("DES") ? "AES" : "AES";
        const isCBC = trans.includes("CBC");
        const algorithm = isCBC ? { name: "AES-CBC", iv: ivBytes || new Uint8Array(16) } : { name: "AES-ECB" };
        return await crypto.subtle.importKey("raw", rawKey, algorithm, false, isEncrypt ? ["encrypt"] : ["decrypt"]);
      };

      return {
        decrypt: async (data: string | Uint8Array) => {
          try {
            const key = await getCryptoKey(keyBytes, false);
            const cipherText = typeof data === "string" ? new TextEncoder().encode(data) : data;
            const decrypted = await crypto.subtle.decrypt(
              trans.includes("CBC") ? { name: "AES-CBC", iv: ivBytes || new Uint8Array(16) } : { name: "AES-ECB" },
              key,
              cipherText
            );
            return new Uint8Array(decrypted);
          } catch {
            return new Uint8Array(0);
          }
        },
        decryptStr: async (data: string) => {
          try {
            const result = await this.decrypt(data);
            return new TextDecoder().decode(result);
          } catch {
            return "";
          }
        },
        encrypt: async (data: string | Uint8Array) => {
          try {
            const key = await getCryptoKey(keyBytes, true);
            const plainText = typeof data === "string" ? new TextEncoder().encode(data) : data;
            const encrypted = await crypto.subtle.encrypt(
              trans.includes("CBC") ? { name: "AES-CBC", iv: ivBytes || new Uint8Array(16) } : { name: "AES-ECB" },
              key,
              plainText
            );
            return new Uint8Array(encrypted);
          } catch {
            return new Uint8Array(0);
          }
        },
        encryptBase64: async (data: string) => {
          try {
            const result = await this.encrypt(data);
            return btoa(String.fromCharCode(...(Array.from(result) as number[])));
          } catch {
            return "";
          }
        },
        encryptHex: async (data: string) => {
          try {
            const result = await this.encrypt(data);
            return (Array.from(result) as number[]).map((b) => b.toString(16).padStart(2, "0")).join("");
          } catch {
            return "";
          }
        },
        setIv: (iv: string | Uint8Array) => {
          // IV 将在下次操作时使用
          return this;
        },
      };
    },
    createAsymmetricCrypto: (transformation: string) => {
      return {
        encrypt: async (data: string | Uint8Array) => new Uint8Array(0),
        decrypt: async (data: string | Uint8Array) => new Uint8Array(0),
      };
    },
    createSign: (algorithm: string) => {
      return {
        sign: async (data: string | Uint8Array) => new Uint8Array(0),
        verify: async (data: string | Uint8Array, signature: string | Uint8Array) => false,
      };
    },
    Map: (key: string) => {
      // 同步读取源变量（内存缓存）
      const srcVal = sourceHelper.getVariableSync(key);
      if (srcVal && srcVal !== "0" && srcVal !== "") return srcVal;
      return "";
    },
    ajaxAll: async (urls: string[]) => {
      // 并发请求多个 URL，返回类 StrResponse 对象数组（含 body() 和 url() 方法）
      const results = await Promise.all(
        urls.map(async (url) => {
          try {
            if (!isSafeRemoteUrl(url)) return { body: () => "", url: () => url, headers: () => ({}), status: () => 0 };
            const resp = await fetch(url, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            });
            const bodyText = await resp.text();
            return {
              body: () => bodyText,
              url: () => url,
              headers: () => resp.headers,
              status: () => resp.status,
            };
          } catch {
            return {
              body: () => "",
              url: () => url,
              headers: () => ({}),
              status: () => 0,
            };
          }
        })
      );
      return results;
    },
    toast: () => undefined,
    longToast: (msg: any) => undefined,
  };

  const sourceHelper = {
    getKey: () => source?.bookSourceUrl || baseUrl || "",
    bookSourceUrl: source?.bookSourceUrl || "",
    bookSourceName: source?.bookSourceName || "",
    put: async (k: string, v: any) => {
      const res = await javaPut(k, v);
      // 同步更新内存缓存
      if (typeof v === "string") variableCache.set(k, v);
      else variableCache.set(k, String(v));
      return res;
    },
    getVariable: async (k: string) => {
      return await bookGet(k) || "";
    },
    getVariableSync: (k: string) => {
      return variableCache.get(k) || "";
    },
    get bookSourceComment() {
      const raw = source?.bookSourceComment || "";
      let processed = String(raw).replace(/\.length\(\)/g, '.length');
      processed = processed.replace(/function\s+decode\s*\(/g, "globalThis.decode = async function decode(");
      // await async java methods inside <js> blocks (eval'd at runtime, not preprocessed by executeLegadoJs)
      processed = processed.replace(/\bjava\.digestHex\s*\(/g, "await java.digestHex(");
      processed = processed.replace(/\bjava\.aesBase64DecodeToString\s*\(/g, "await java.aesBase64DecodeToString(");
      processed = processed.replace(/(\w+\.doFinal\s*\()/g, "await $1");
      return processed;
    },
  };

  const bookHelper = {
    name: book?.name || "",
    author: book?.author || "",
    getVariable: async (k: string) => {
      return await bookGet(k) || book?.custom || "0";
    },
    setVariable: async (k: string, v: any) => {
      await bookSet(k, v);
    },
  };

  // Java 类兼容层：供 <js> 块中的 JavaImporter/Packages 使用
  const arrays = {
    copyOfRange: (arr: any, from: number, to?: number) => {
      if (!arr || typeof arr !== "object") return [];
      const a = Array.isArray(arr) ? arr : Array.from(arr);
      const sliced = a.slice(from, to === undefined ? a.length : to);
      // Make String() of byte arrays produce char codes (ISO-8859-1 style, matching Java String(byte[]))
      sliced.toString = function () { return String.fromCharCode(...this); };
      return sliced;
    },
  };
  const integer = {
    parseInt: (s: string, radix?: number) => Number.parseInt(String(s), radix === undefined ? 10 : radix),
  };
  class SecretKeySpec {
    keyBytes: number[];
    algorithm: string;
    constructor(keyBytes: number[] | Uint8Array, algorithm: string) {
      this.keyBytes = Array.from(keyBytes || []);
      this.algorithm = algorithm;
    }
  }
  class IvParameterSpec {
    ivBytes: number[];
    constructor(ivBytes: number[] | Uint8Array) {
      this.ivBytes = Array.from(ivBytes || []);
    }
  }
  // 允许不带 new 调用（Java 语法兼容）
  const SecretKeySpecWrapper = function (keyBytes: number[] | Uint8Array, algorithm: string) {
    return new SecretKeySpec(keyBytes, algorithm);
  };
  const IvParameterSpecWrapper = function (ivBytes: number[] | Uint8Array) {
    return new IvParameterSpec(ivBytes);
  };
  const cipher = {
    getInstance: (algorithm: string) => ({
      init: (mode: number, key: SecretKeySpec, iv: IvParameterSpec) => {
        (this as any)._key = key.keyBytes;
        (this as any)._iv = iv.ivBytes;
        (this as any)._mode = mode;
      },
      doFinal: async (input: number[] | Uint8Array | string) => {
        const data = typeof input === "string" ? strToBytes(input) : Array.from(input);
        const dec = await aesDecryptCbcRaw(data, (this as any)._key, (this as any)._iv);
        return new TextDecoder().decode(new Uint8Array(dec.map((b) => ((b % 256) + 256) % 256)));
      },
    }),
  };

  // 提前定义 Packages，供 JavaImporter 引用
  const packagesObj = {
    java: {
      lang: { Integer: integer },
      util: { Arrays: arrays },
      io: {},
    },
    javax: {
      crypto: {
        spec: { SecretKeySpec: SecretKeySpecWrapper, IvParameterSpec: IvParameterSpecWrapper },
        Cipher: cipher,
      },
    },
    org: {
      jsoup: {
        Jsoup: {
          parse: (html: string) => {
            const $ = cheerio.load(html, { decodeEntities: false } as any);
            return {
              select: (selector: string) => {
                const elements = $(selector);
                return {
                  text: () => elements.text(),
                  attr: (name: string) => elements.attr(name) || "",
                  each: (fn: Function) => elements.each((i, el) => fn(i, $(el))),
                  get: (index: number) => elements.get(index),
                  size: () => elements.length,
                  toArray: () => elements.toArray(),
                };
              },
              title: () => $('title').text(),
              body: () => $('body').html(),
              html: () => $.html(),
            };
          },
        },
      },
    },
  };

return {
    cookie: {
      removeCookie: () => {},
    },
    java,
    Map: (key: string) => {
      // 同步读取源变量（内存缓存）
      const srcVal = sourceHelper.getVariableSync(key);
      if (srcVal && srcVal !== "0" && srcVal !== "") return srcVal;
      return "";
    },
    M: (key: string) => {
      // 兼容 this.M("key") 用法，等同于 Map
      const srcVal = sourceHelper.getVariableSync(key);
      if (srcVal && srcVal !== "0" && srcVal !== "") return srcVal;
      return "";
    },
    toArray: (obj: any) => {
      // 兼容 Java List.toArray() 和 JS 数组
      if (obj == null) return [];
      if (Array.isArray(obj)) return obj;
      if (typeof obj === "object" && typeof obj[Symbol.iterator] === "function") {
        return Array.from(obj);
      }
      return [obj];
    },
    org: packagesObj.org,
    source: sourceHelper,
    book: bookHelper,
    src: result !== undefined ? result : "",
    baseUrl: baseUrl || "",
    result: result !== undefined ? result : "",
    key: key || "",
    page: page || 1,
    JavaImporter: function () {
      const obj: any = {};
      obj.importPackage = (...packages: any[]) => {
        for (const pkg of packages) {
          const walk = (o: any) => {
            for (const [k, v] of Object.entries(o)) {
              if (!(k in obj)) obj[k] = v;
              if (v && typeof v === "object" && !(v instanceof Function)) walk(v);
            }
          };
          walk(pkg);
        }
      };
      return obj;
    },
    Packages: packagesObj,
  };
}

export async function executeLegadoJs(code: string, context: LegadoContext = {}, remoteWebviewApi?: string): Promise<any> {
  const env = createLegadoEnvironment(context);
  let cleanCode = code.trim();

  // 兼容 Java 语法：String.length() 方法（JS 中 length 是属性，非方法）
  cleanCode = cleanCode.replace(/\.length\(\)/g, '.length');

  // 兼容 Java List.toArray() -> JS 数组无需转换
  cleanCode = cleanCode.replace(/\.toArray\(\)/g, '');

  // 确保 String.prototype.getBytes 可用（Java 语法 str.getBytes()）
  if (typeof String.prototype.getBytes === 'undefined') {
    Object.defineProperty(String.prototype, 'getBytes', {
      value: function () { return strToBytes(this); },
      writable: true,
      configurable: true,
    });
  }

  if (cleanCode.startsWith("@js:")) cleanCode = cleanCode.substring(4).trim();
  cleanCode = cleanCode.replace(/^<js>\s*/i, "").replace(/\s*<\/js>$/i, "");
  cleanCode = cleanCode.replace(/(\.map\s*\()\s*(\[[^\]]+\])\s*=>/g, "$1($2) =>");

  cleanCode = cleanCode.replace(/\bjava\.aesBase64DecodeToString\s*\(/g, "await java.aesBase64DecodeToString(");
  cleanCode = cleanCode.replace(/\bjava\.ajax\s*\(/g, "await java.ajax(");
  cleanCode = cleanCode.replace(/\bjava\.ajaxAll\s*\(/g, "await java.ajaxAll(");
  cleanCode = cleanCode.replace(/\bjava\.digestHex\s*\(/g, "await java.digestHex(");
  cleanCode = cleanCode.replace(/(\w+\.doFinal\s*\()/g, "await $1");
  // Define decode on globalThis so it survives strict-mode eval
  cleanCode = cleanCode.replace(/function\s+decode\s*\(/g, "globalThis.decode = async function decode(");
  // Route remaining decode() calls through globalThis (with await)
  cleanCode = cleanCode.replace(/(?<!globalThis\.)\bdecode\s*\(/g, "await globalThis.decode(");
  cleanCode = cleanCode.replace(/\bjava\.put\s*\(/g, "await java.put(");
  cleanCode = cleanCode.replace(/\bjava\.get\s*\(/g, "await java.get(");
  cleanCode = cleanCode.replace(/\bsource\.put\s*\(/g, "await source.put(");
  cleanCode = cleanCode.replace(/\bsource\.getVariable\s*\(/g, "await source.getVariable(");
  cleanCode = cleanCode.replace(/\bbook\.getVariable\s*\(/g, "await book.getVariable(");
  cleanCode = cleanCode.replace(/\bbook\.setVariable\s*\(/g, "await book.setVariable(");

  // 兼容 Java/Rhino：对可能为 undefined 的数组访问 [0] 做空值保护（result.book[0]==undefined → result.book==undefined||result.book[0]==undefined）
  cleanCode = cleanCode.replace(/([\w.]+)\[0\]\s*===\s*undefined/g, "$1===undefined||$1[0]===undefined");
  cleanCode = cleanCode.replace(/([\w.]+)\[0\]\s*==\s*undefined/g, "$1==undefined||$1[0]==undefined");

  // 声明语句不能用 return (...) 包装
  const declarationRe = /^(var|let|const|function|class|if|for|while|do|switch|try|catch|return|throw|break|continue|import|export)\b/;

  // 预处理：将 if-else 语句转换为返回值的 IIFE（模拟 Rhino 的 completion value 行为）
  function transformIfElseToReturn(code: string): string {
    // 简单检测：单个 if-else 语句，且 else 分支以表达式结束
    // 模式: if (cond) { ... } else { expr }
    const trimmed = code.trim();
    const ifElseMatch = trimmed.match(/^if\s*\(([\s\S]*?)\)\s*\{([\s\S]*?)\}\s*else\s*\{([\s\S]*?)\}\s*$/);
    if (ifElseMatch) {
      const [, cond, ifBody, elseBody] = ifElseMatch;
      // 提取 if 分支的最后表达式
      const ifExpr = ifBody.trim().split(";").pop()?.trim() || "";
      const elseExpr = elseBody.trim().split(";").pop()?.trim() || "";
      if (ifExpr && elseExpr) {
        return `(function() { if (${cond}) { return ${ifExpr} } else { return ${elseExpr} } })()`;
      }
    }
    return code;
  }

  // Transform code to ensure last expression is returned
  function ensureReturn(code: string): string {
    const parts: string[] = [];
    let current = "";
    let inString = false;
    let stringChar = "";
    let inLineComment = false;
    let inBlockComment = false;
    let inRegex = false;

    // Characters that, when they appear right before `/`, mean `/` starts a regex (not division)
    const regexStartCtx = new Set([
      "(", "[", "{", ",", ";", ":",
      "=", "+", "-", "*", "%", "&", "|", "^", "~", "!", "<", ">", "?",
      "return", "case", "throw", "new", "delete", "typeof", "void", "yield", "await",
    ]);

    // Track previous non-whitespace char to determine if / starts a regex
    let prevNonSpace = "";

    const updatePrevNonSpace = (ch: string) => {
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
        prevNonSpace = ch;
      }
    };

    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      const next = code[i + 1];

      if (inLineComment) {
        if (ch === "\n") {
          inLineComment = false;
          current += ch;
        }
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (inRegex) {
        current += ch;
        if (ch === "\\") {
          current += code[++i];
          updatePrevNonSpace(ch);
        } else if (ch === "/") {
          // Consume flags
          if (next && /[gimsuy]/.test(next)) {
            current += code[++i];
            while (i + 1 < code.length && /[gimsuy]/.test(code[i + 1])) {
              current += code[++i];
            }
          }
          inRegex = false;
        }
        updatePrevNonSpace(ch);
        continue;
      }

      if (inString) {
        current += ch;
        if (ch === "\\") {
          current += code[++i];
          updatePrevNonSpace(ch);
        } else if (ch === stringChar) {
          inString = false;
        }
        updatePrevNonSpace(ch);
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inString = true;
        stringChar = ch;
        current += ch;
        updatePrevNonSpace(ch);
        continue;
      }

      if (ch === "/") {
        // Decide: regex or division?
        const isRegexStart =
          prevNonSpace === "" ||
          regexStartCtx.has(prevNonSpace) ||
          prevNonSpace.length > 1; // multi-char keyword like 'return'

        if (isRegexStart) {
          inRegex = true;
          current += ch;
          updatePrevNonSpace(ch);
          continue;
        }
        // Otherwise it's division
        current += ch;
        updatePrevNonSpace(ch);
        continue;
      }

      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === ";") {
        parts.push(current);
        current = "";
        updatePrevNonSpace(ch);
        continue;
      }

      current += ch;
      updatePrevNonSpace(ch);
    }

    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);

    const nonEmpty = parts.filter((p) => p.length > 0);
    if (nonEmpty.length === 0) return code;
    if (nonEmpty.length === 1) {
      const single = nonEmpty[0].trim();
      // 声明语句（if/for/while/switch/try等）不能用 return 包装
      if (declarationRe.test(single)) {
        return `; ${single};`;
      }
      return `return ${single};`;
    }

    // Multiple statements: keep all but the last as-is, add return only if last is an expression
    let last = nonEmpty.pop()!.trim();
    let prefix = nonEmpty.join("; ");
    // If last part starts with '}', it means a closing brace was merged with
    // the next statement (no ';' between them). Move the brace to prefix.
    if (last.startsWith('}')) {
      const braceEnd = last.indexOf('}') + 1;
      prefix += last.slice(0, braceEnd);
      last = last.slice(braceEnd).trim();
    }
    const lastIsExpr = !declarationRe.test(last.trim());
    if (lastIsExpr) {
      return prefix + "; return " + last + ";";
    }
    return prefix + "; " + last + ";";
  }

  let bodyCode: string;
  if (!cleanCode.includes(";") && !cleanCode.includes("\n") && !cleanCode.startsWith("return") && !declarationRe.test(cleanCode.trim())) {
    bodyCode = `return (${cleanCode});`;
  } else {
    // 预处理 if-else 语句，使其返回分支的表达式值
    const transformedCode = transformIfElseToReturn(cleanCode);
    const execCode = ensureReturn(transformedCode);
    bodyCode = execCode;
  }

  try {
    const out = await evaluateLegadoJs(bodyCode, env, undefined, context.remoteWebviewApi);
    return out === null ? (context.result ?? null) : out;
  } catch (err: any) {
    console.warn("Legado JS execution error:", err.message);
    return context.result ?? null;
  }
}

// ==========================================
// 6. Chapter Parsing
// ==========================================

export interface ParsedChapterItem {
  index: number;
  title: string;
  url: string;
}

export async function parseChapterListWithRules(
  rawText: string,
  source: any,
  targetUrl: string
): Promise<ParsedChapterItem[]> {
  const chapters: ParsedChapterItem[] = [];
  const ruleToc = source?.ruleToc || {};
  let listRule = (ruleToc.chapterList || "").trim();

  let data: any = null;
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { data = JSON.parse(trimmed); } catch {}
  }

  // 去掉 Legado "+" 追加模式前缀，再判断是否为 @js: 块
  let jsListRule = listRule.replace(/^\+/, "");

  // 提取所有 <js>...</js> 块，剩余部分作为 CSS 选择器
  const jsBlocks: string[] = [];
  const jsRegex = /<js>([\s\S]*?)<\/js>/gi;
  let jsMatch: RegExpExecArray | null;
  while ((jsMatch = jsRegex.exec(listRule)) !== null) {
    jsBlocks.push(jsMatch[1].trim());
  }
  const cssSelector = listRule.replace(/<js>[\s\S]*?<\/js>/g, "").trim();

  if (jsListRule.startsWith("@js:") || jsBlocks.length > 0) {
    // 纯 @js: 前缀（无 <js> 块）：直接执行 JS，result 为原始 HTML
    // 有 <js> 块：先用剩余 CSS 选择器解析 HTML，再按顺序执行 JS 块，result 传递
    let currentResult: any = rawText;
    let jsRes: any = null;

    if (jsBlocks.length > 0 && cssSelector) {
      try {
        const nodes = parseHtmlElements(rawText, cssSelector);
        currentResult = nodes.length > 0 ? nodes : rawText;
      } catch (e: any) {
        console.error(`[parseChapterListWithRules] CSS parse failed: ${e.message}`);
        currentResult = rawText;
      }
    }

    if (jsListRule.startsWith("@js:") && jsBlocks.length === 0) {
      // 纯 @js: 块
      const jsCode = jsListRule.substring(4).trim();
      try {
        jsRes = await executeLegadoJs(jsCode, {
          source,
          baseUrl: targetUrl,
          result: currentResult,
        });
      } catch (e: any) {
        console.error(`[parseChapterListWithRules] @js: execution failed: ${e.message}`);
      }
    } else {
      // 有 <js> 块：按顺序执行
      for (const block of jsBlocks) {
        try {
          const res = await executeLegadoJs(block, {
            source,
            baseUrl: targetUrl,
            result: currentResult,
          });
          if (res != null) {
            currentResult = res;
          }
        } catch (e: any) {
          console.error(`[parseChapterListWithRules] JS block execution failed: ${e.message}`);
        }
      }
      jsRes = currentResult;
    }

    if (Array.isArray(jsRes)) {
      data = jsRes;
      listRule = "$";
    } else if (typeof jsRes === "string") {
      try {
        data = JSON.parse(jsRes);
        listRule = "$";
      } catch {
        // JS 块返回字符串但不是有效 JSON，回退到 CSS 选择器
        if (!cssSelector || cssSelector.startsWith("@js:")) {
          return [];
        }
        listRule = cssSelector;
      }
    } else {
      // JS 块执行失败或返回非数组/非字符串
      if (!cssSelector || cssSelector.startsWith("@js:")) {
        // 纯 JS 规则且执行失败，无 CSS 选择器可回退，返回空
        return [];
      }
      // 如果回退选择器是 JSONPath（以 $ 开头），但当前 data 是详情页 JSON 而非章节列表 JSON，
      // 则不应应用该 JSONPath（会导致错误解析），直接返回空
      if (cssSelector.startsWith("$")) {
        return [];
      }
      listRule = cssSelector;
    }
  }

  let rawChapters: any[] = [];
  if (data) {
    const extracted = jsonpathQuery(data, listRule || "$.data.chapters");
    if (Array.isArray(extracted)) rawChapters = extracted;
    else if (Array.isArray(data)) rawChapters = data;
  } else {
    try {
      rawChapters = parseHtmlElements(rawText, listRule || "a");
    } catch (e: any) {
      console.error(`[parseChapterListWithRules] parseHtmlElements failed: ${e.message}, listRule="${listRule}"`);
      return [];
    }
  }

  const baseDomain = new URL(targetUrl).origin;
  for (let idx = 0; idx < rawChapters.length; idx++) {
    const ch = rawChapters[idx];
    let title = "";
    let url = "";

    try {
      if (typeof ch === "object" && (ch as any).html !== undefined) {
        // HTML 模式
        const nodeHtml = (ch as HtmlNode).html || "";
        const nameRule = (ruleToc.chapterName || "text").trim();
        const urlRule = (ruleToc.chapterUrl || "href").trim();
        // 纯属性名直接从 attrs 提取（避免被 legadoToCss 误当作 CSS 类选择器）
        // 支持 attr##replaceRegex##replaceWith 模式（如 href##$##,{'webView': true}）
        const isPlainAttr = (r: string) => r && !r.includes(" ") && !r.startsWith(".") && !r.startsWith("#") && !r.startsWith("[") && !r.includes("@");
        const attrExtractMatch = urlRule.match(/^(href|src|text|html)##(.*)$/);
        let attrUrl = "";
        if (attrExtractMatch) {
          const attrName = attrExtractMatch[1];
          const restParts = splitTopLevel(attrExtractMatch[2], ["##"]).parts;
          const repPattern = restParts[0] || "";
          const repWith = restParts[1] || "";
          attrUrl = (ch as any).attrs[attrName.toLowerCase()] || "";
          if (repPattern) {
            try { attrUrl = attrUrl.replace(new RegExp(repPattern, "g"), repWith); } catch {}
          }
        }
        title = isPlainAttr(nameRule) ? ((ch as any).attrs[nameRule.toLowerCase()] || (ch as HtmlNode).text)
          : (extractTextFromHtml(nodeHtml, nameRule) || (ch as HtmlNode).text);
        url = isPlainAttr(urlRule) ? ((ch as any).attrs[urlRule.toLowerCase()] || "")
          : (attrUrl || extractTextFromHtml(nodeHtml, urlRule) || (ch as HtmlNode).attrs["href"] || "");
      } else if (typeof ch === "object") {
        // JSON 模式（来自 JSONPath 提取）
        const nameRule = ruleToc.chapterName || "name";
        if (nameRule.includes("java.aesBase64DecodeToString")) {
          const match = nameRule.match(
            /java\.aesBase64DecodeToString\s*\(\s*([^,]+)\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/
          );
          if (match) {
            try {
              const fieldRule = nameRule.split("@js:")[0];
              const rawVal = String(jsonpathFirstString(ch, fieldRule.trim()) || ch.name || ch.title || "");
              const key = new TextEncoder().encode(match[2]);
              const iv = new TextEncoder().encode(match[4]);
              const dec = await aesDecryptCbc(rawVal, key, iv);
              title = new TextDecoder().decode(dec);
            } catch {}
          }
        }
        if (!title && nameRule.includes("@js:")) {
          const [fieldRule, jsPart] = nameRule.split("@js:");
          const rawVal = jsonpathFirstString(ch, fieldRule.trim()) || ch.name || ch.title || "";
          try {
            title = await executeLegadoJs(jsPart, {
              source,
              baseUrl: targetUrl,
              result: String(rawVal),
            });
          } catch (e: any) {
            console.error(`[parseChapterListWithRules] chapterName @js: failed: ${e.message}`);
          }
        } else if (!title) {
          title = String(jsonpathFirstString(ch, nameRule) || ch.name || ch.title || `第 ${idx + 1} 章`);
        }

        const urlRule = ruleToc.chapterUrl || "url";
        if (urlRule.includes("{{")) {
          const regex = /\{\{([\s\S]*?)\}\}/g;
          url = urlRule;
          let um;
          while ((um = regex.exec(urlRule)) !== null) {
            const expr = um[1].trim();
            let val = "";
            if (expr.startsWith("$.") || expr.startsWith("$..") || expr === "$") {
              val = String(jsonpathFirstString(ch, expr) ?? "");
            } else if (expr.includes("source.getKey()") || expr.includes("java.")) {
              try {
                const jsRes = await executeLegadoJs(expr, { source, baseUrl: targetUrl, result: ch });
                val = String(jsRes ?? "");
              } catch (e: any) {
                console.error(`[parseChapterListWithRules] chapterUrl JS failed: ${e.message}`);
              }
            } else {
              val = String(ch[expr] ?? "");
            }
            url = url.replace(um[0], val);
          }
        } else {
          url = String(jsonpathFirstString(ch, urlRule) || ch.url || ch.link || ch.path || "");
        }
      }
    } catch (e: any) {
      console.error(`[parseChapterListWithRules] Chapter processing failed: ${e.message}`);
      continue;
    }

    if (url.startsWith("//")) {
      url = `${new URL(baseDomain).protocol}${url}`;
    } else if (url && !url.startsWith("http")) {
      url = `${baseDomain}/${url.replace(/^\/+/, "")}`;
    }
    // 剥离 Legado 元数据后缀（如 ,{"webView": true} / ,{'webView': true}），保留纯净 URL
    url = url.replace(/,{"webView": true}$/, "").replace(/,{'webView': true}$/, "");

    if (title && url) {
      chapters.push({
        index: idx,
        title: title.trim(),
        url: url.trim(),
      });
    }
  }

  return chapters;
}

export async function indexSourceBookIntoDatabase(
  env: Env,
  userNs: string,
  bookSourceUrl: string,
  bookUrl: string,
  bookName?: string
): Promise<SourceBookIndexResult> {
  console.log(`[SourceBookIndex] start userNs=${userNs} bookSourceUrl=${bookSourceUrl} bookUrl=${bookUrl}`);

  const sRow = await env.DB.prepare(
    `SELECT json FROM book_sources WHERE user_ns = ?1 AND book_source_url = ?2`
  )
    .bind(userNs, bookSourceUrl)
    .first<{ json: string }>();
  let source: any = null;
  if (sRow) {
    try { source = JSON.parse(sRow.json); } catch {}
  }

  let title = bookName || "";
  let author = "未知作者";
  let coverUrl = "";
  let intro = "";

  try {
    const detailHtml = await fetchSourceText(bookUrl, source);
    if (detailHtml && detailHtml.length > 0) {
      const titleMatch = detailHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (titleMatch && !title) title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
      const authorMatch = detailHtml.match(/(?:作者|author)[^>]*>([\s\S]*?)<\/[^>]*>/i);
      if (authorMatch) author = authorMatch[1].replace(/<[^>]+>/g, "").trim() || "未知作者";
      const coverMatch = detailHtml.match(/<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
      if (coverMatch) coverUrl = coverMatch[1];
    }
  } catch (err: any) {
    console.log(`[SourceBookIndex] fetch detail failed bookUrl=${bookUrl} err=${err.message || err}`);
  }

  if (!title) title = bookName || "未知书名";

  let chapters: Array<{ index: number; title: string; url: string }> = [];
  try {
    const tocHtml = await fetchSourceText(bookUrl, source);
    let parsed: ParsedChapterItem[];
    const ruleToc = source?.ruleToc || {};
    const listRule = (ruleToc.chapterList || "").trim();
    const isXpathRule = listRule.startsWith("/") || listRule.startsWith("./");

    if (isWasmAvailable() && isXpathRule) {
      try {
        const nameRule = ruleToc.chapterName || "./text()";
        const urlRule = ruleToc.chapterUrl || "./@href";
        const wasmChapters = await parseTocXpathWasm(tocHtml, listRule, nameRule, urlRule, bookUrl);
        parsed = wasmChapters.map((c, idx) => ({
          index: c.index ?? idx,
          title: c.title,
          url: c.url,
        }));
      } catch (wasmErr: any) {
        console.log(`[SourceBookIndex] wasm xpath parse failed, fallback to TS bookUrl=${bookUrl} err=${wasmErr.message || wasmErr}`);
        parsed = await parseChapterListWithRules(tocHtml, source, bookUrl);
      }
    } else {
      parsed = await parseChapterListWithRules(tocHtml, source, bookUrl);
    }
    chapters = parsed.map((ch, idx) => ({
      index: ch.index ?? idx,
      title: ch.title,
      url: ch.url,
    }));
  } catch (err: any) {
    console.log(`[SourceBookIndex] parse toc failed bookUrl=${bookUrl} err=${err.message || err}`);
  }

  const totalChapters = chapters.length;
  const now = Math.floor(Date.now() / 1000);
  const bookId = stableBookId(bookSourceUrl, bookUrl);

  const newBook = {
    name: title,
    author,
    bookUrl,
    origin: "source",
    originName: source?.bookSourceName || "书源",
    tocUrl: bookUrl,
    canUpdate: false,
    durChapterIndex: 0,
    durChapterPos: 0,
    durChapterTitle: chapters[0]?.title || "第一章",
    durChapterTime: now,
    totalChapterNum: totalChapters,
    latestChapterTitle: chapters[chapters.length - 1]?.title,
    kind: "网络连载",
    coverUrl,
    intro,
  };

  const bookDetail = {
    ...newBook,
    bookId,
    r2Key: "",
    fileSize: 0,
    updatedAt: now,
    chapters: chapters.map((ch) => ({
      index: ch.index,
      title: ch.title,
      url: ch.url,
    })),
  };
  await documentHandlers.saveBookDetail(env, userNs, bookId, bookDetail);

  console.log(`[SourceBookIndex] end userNs=${userNs} bookId=${bookId} title=${title} totalChapters=${totalChapters}`);

  return { title, author, totalChapters, chapters };
}

export async function handleSourceBookImport(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userNs = await resolveUserNs(request, env);
  if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

  const body = await request.json<any>();
  const { bookSourceUrl, bookUrl, bookName } = body || {};
  if (!bookSourceUrl || !bookUrl) {
    return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookSourceUrl 或 bookUrl" });
  }

  if (!isSafeRemoteUrl(bookUrl)) {
    return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
  }

  console.log(`[SourceBookImport] start userNs=${userNs} bookSourceUrl=${bookSourceUrl} bookUrl=${bookUrl}`);

  let shelf: any[] = [];
  try {
    shelf = (await documentHandlers.getDocument(env, userNs, "bookshelf.json")) || [];
  } catch (shelfErr: any) {
    console.log(`[SourceBookImport] get shelf error userNs=${userNs} err=${shelfErr.message || shelfErr}`);
    return jsonResponse({ isSuccess: false, errorMsg: `读取书架失败：${shelfErr.message || shelfErr}` });
  }

  const existingIdx = shelf.findIndex((b) => b.bookUrl === bookUrl && b.origin === "source");
  if (existingIdx >= 0) {
    return jsonResponse({ isSuccess: false, errorMsg: "书籍已存在于书架" });
  }

  const now = Math.floor(Date.now() / 1000);
  let newBook: any;

  try {
    const result = await indexSourceBookIntoDatabase(env, userNs, bookSourceUrl, bookUrl, bookName);
    newBook = {
      name: result.title,
      author: result.author,
      bookUrl,
      origin: "source",
      originName: "书源",
      tocUrl: bookUrl,
      canUpdate: false,
      durChapterIndex: 0,
      durChapterPos: 0,
      durChapterTitle: result.chapters[0]?.title || "第一章",
      durChapterTime: now,
      totalChapterNum: result.totalChapters,
      latestChapterTitle: result.chapters[result.totalChapters - 1]?.title,
      kind: "网络连载",
    };
  } catch (err: any) {
    console.log(`[SourceBookImport] index error bookUrl=${bookUrl} err=${err.message || err}`);
    return jsonResponse({ isSuccess: false, errorMsg: `书源书籍入库失败：${err.message || err}` });
  }

  shelf.unshift(newBook);
  try {
    await documentHandlers.saveDocument(env, userNs, "bookshelf.json", shelf);
    triggerOnChangeSync(env, userNs, ctx);
  } catch (shelfErr: any) {
    console.log(`[SourceBookImport] save shelf error bookUrl=${bookUrl} err=${shelfErr.message || shelfErr}`);
    return jsonResponse({ isSuccess: false, errorMsg: `保存书架失败：${shelfErr.message || shelfErr}` });
  }

  return jsonResponse({ isSuccess: true, data: newBook });
}

// ==========================================
// 9. URL Analyzer (Aligned with Rust url_analyzer.rs)
// ==========================================

export interface RequestSpec {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
  charset?: string;
  retry?: number;
}

function resolveUrl(base: string, url: string): string {
  try {
    const baseUrl = new URL(base);
    baseUrl.hash = "";
    const u = new URL(url, baseUrl);
    return u.toString();
  } catch {
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) {
      try { return new URL(base).origin + url; } catch { return url; }
    }
    return url;
  }
}

export async function analyzeUrl(
  ruleUrl: string,
  key: string,
  page: number,
  baseUrl: string,
  source?: any
): Promise<RequestSpec> {
  let rawUrl = (ruleUrl || "").trim();
  let urlConfig: any = null;

  // Split options after comma
  if (rawUrl.includes(",{") || rawUrl.includes(", {")) {
    const idx = rawUrl.indexOf(",{") !== -1 ? rawUrl.indexOf(",{") : rawUrl.indexOf(", {");
    try {
      urlConfig = JSON.parse(rawUrl.substring(idx + 1));
    } catch {}
    rawUrl = rawUrl.substring(0, idx).trim();
  }

  // Handle page choices: <1,2,3>
  const choiceMatch = rawUrl.match(/<([^>]+)>/);
  if (choiceMatch) {
    const choices = choiceMatch[1].split(",");
    const chosen = choices[Math.min(page - 1, choices.length - 1)] || String(page);
    rawUrl = rawUrl.replace(choiceMatch[0], chosen);
  }

  // Handle placeholders: {{key}}, {key}, {{page}}, {page}
  const encodedKey = encodeURIComponent(key);
  rawUrl = rawUrl
    .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
    .replace(/\{key\}/gi, encodedKey)
    .replace(/\$\{key\}/g, encodedKey)
    .replace(/\{\{page\}\}/g, String(page))
    .replace(/\{page\}/g, String(page))
    .replace(/\$\{page\}/g, String(page))
    .replace(/\{\{page-1\}\}/g, String(page - 1))
    .replace(/\$\{page-1\}/g, String(page - 1));

  // Resolve base URL
  if (rawUrl.startsWith("//")) {
    const proto = baseUrl.startsWith("https") ? "https:" : "http:";
    rawUrl = `${proto}${rawUrl}`;
  } else if (rawUrl.startsWith("/")) {
    const baseOrigin = new URL(baseUrl).origin;
    rawUrl = `${baseOrigin}${rawUrl}`;
  } else if (!rawUrl.startsWith("http")) {
    rawUrl = `${baseUrl.replace(/\/$/, "")}/${rawUrl.replace(/^\/+/, "")}`;
  }

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };

  const domain = new URL(rawUrl).origin;
  const isIp = /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(rawUrl);
  if (!isIp) {
    headers["Referer"] = `${domain}/`;
  }

  // Dynamic header execution
  if (source?.header) {
    const hdr = String(source.header).trim();
    if (hdr.startsWith("@js:") || hdr.includes("java.md5Encode")) {
      const jsHdr = await executeLegadoJs(hdr, { source, baseUrl: rawUrl, key, page });
      if (typeof jsHdr === "string") {
        try { Object.assign(headers, JSON.parse(jsHdr)); } catch {}
      } else if (typeof jsHdr === "object" && jsHdr) {
        Object.assign(headers, jsHdr);
      }
    } else {
      try { Object.assign(headers, JSON.parse(hdr)); } catch {}
    }
  }

  let method: "GET" | "POST" = "GET";
  let bodyStr: string | null = null;
  let charset: string | undefined = undefined;
  let retry = 0;

  if (urlConfig) {
    if (urlConfig.method) method = urlConfig.method.toUpperCase() === "POST" ? "POST" : "GET";
    if (urlConfig.headers) Object.assign(headers, urlConfig.headers);
    if (urlConfig.charset) charset = urlConfig.charset;
    if (urlConfig.retry) retry = Number(urlConfig.retry) || 0;
    if (urlConfig.body) {
      bodyStr = typeof urlConfig.body === "string" ? urlConfig.body : JSON.stringify(urlConfig.body);
      bodyStr = bodyStr
        .replace(/\{\{[^}]*key[^}]*\}\}/gi, encodedKey)
        .replace(/\{key\}/gi, encodedKey)
        .replace(/\$\{key\}/g, encodedKey)
        .replace(/\{\{page\}\}/g, String(page))
        .replace(/\$\{page\}/g, String(page));
      if (typeof urlConfig.body !== "string" && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  return {
    url: rawUrl,
    method,
    headers,
    body: bodyStr,
    charset,
    retry,
  };
}

// ==========================================
// 10. Search Results Parsing
// ==========================================

export interface ParsedBookItem {
  name: string;
  author: string;
  bookUrl: string;
  origin: string;
  originName: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  wordCount?: string;
  latestChapterTitle?: string;
}

export async function parseSearchResultsWithRules(
  rawText: string,
  source: any,
  baseUrl: string,
  keyword: string
): Promise<ParsedBookItem[]> {
  const books: ParsedBookItem[] = [];
  const ruleSearch = source.ruleSearch || {};

  let data: any = null;
  const trimmed = rawText.trim();
  const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (isJson) {
    try { data = JSON.parse(trimmed); } catch {}
  }

  let bookListRule = ruleSearch.bookList || "$.data.list";

  // 解析规则链：分离 <js>...</js> 和 @js:... 块，按顺序执行（模拟 Legado SourceRule 链式处理）
  const jsRegex = /<js>([\s\S]*?)<\/js>|@js:([\s\S]*?)(?=<js>|@js:|$)/gi;
  let currentResult: any = data !== null ? data : rawText;
  let jsMatch: RegExpExecArray | null;
  let lastEnd = 0;
  const ruleParts: Array<{ type: "jsonpath" | "js" | "html"; expr: string }> = [];

  // 先按 || 分割顶层规则（Legado 语义：按顺序尝试每个选择器，取第一个非空结果）
  const topLevelRules = splitTopLevel(bookListRule, ["||"]).parts.map(s => s.trim()).filter(Boolean);

  for (const topRule of topLevelRules) {
    // 对每个顶层规则，再分离 JS 块
    let jsMatch2: RegExpExecArray | null;
    let lastEnd2 = 0;
    const jsRegex2 = /<js>([\s\S]*?)<\/js>|@js:([\s\S]*?)(?=<js>|@js:|$)/gi;
    const subParts: Array<{ type: "jsonpath" | "js" | "html"; expr: string }> = [];

    while ((jsMatch2 = jsRegex2.exec(topRule)) !== null) {
      const beforeJs = topRule.substring(lastEnd2, jsMatch2.index).trim();
      if (beforeJs) {
        subParts.push({ type: isJson ? "jsonpath" : "html", expr: beforeJs });
      }
      const jsContent = (jsMatch2[1] || jsMatch2[2] || "").trim();
      if (jsContent) {
        subParts.push({ type: "js", expr: jsContent });
      }
      lastEnd2 = jsRegex2.lastIndex;
    }
    const remaining2 = topRule.substring(lastEnd2).trim();
    if (remaining2) {
      subParts.push({ type: isJson ? "jsonpath" : "html", expr: remaining2 });
    }

    ruleParts.push(...subParts);
  }

  // 按顺序执行规则链
  for (const part of ruleParts) {
    if (part.type === "jsonpath") {
      console.log(`[parseSearchResultsWithRules] JSONPath: ${part.expr}`);
      const extracted = jsonpathQuery(currentResult, part.expr);
      console.log(`[parseSearchResultsWithRules] JSONPath result: ${extracted !== null && extracted !== undefined ? (Array.isArray(extracted) ? `array[${extracted.length}]` : typeof extracted) : 'null/undefined'}`);
      if (extracted !== null && extracted !== undefined) {
        currentResult = extracted;
      }
    } else if (part.type === "html") {
      console.log(`[parseSearchResultsWithRules] HTML/CSS: ${part.expr}`);
      const nodes = parseHtmlElements(String(currentResult), part.expr);
      console.log(`[parseSearchResultsWithRules] HTML result: array[${nodes.length}]`);
      if (nodes.length > 0) {
        currentResult = nodes;
      }
    } else if (part.type === "js") {
      console.log(`[parseSearchResultsWithRules] JS block: ${part.expr.substring(0, 100)}...`);
      try {
        let jsRes = await executeLegadoJs(part.expr, {
          source,
          baseUrl,
          result: currentResult,
          key: keyword,
        });
        // 如果 JS 返回 JSON 字符串，尝试解析
        if (typeof jsRes === "string") {
          try { jsRes = JSON.parse(jsRes); } catch {}
        }
        console.log(`[parseSearchResultsWithRules] JS result: ${jsRes !== null && jsRes !== undefined ? (Array.isArray(jsRes) ? `array[${jsRes.length}]` : typeof jsRes) : 'null/undefined'}`);
        if (jsRes != null) {
          currentResult = jsRes;
        }
      } catch (e: any) {
        console.error("[parseSearchResultsWithRules] JS execution error:", e.message);
      }
    }
  }

  let items: any[] = [];
  if (Array.isArray(currentResult)) {
    items = currentResult;
  } else if (currentResult && typeof currentResult === "object") {
    items = [currentResult];
  }

  const baseDomain = new URL(baseUrl).origin;
  for (const item of items.slice(0, 30)) {
    let name = "";
    let author = "";
    let coverUrl = "";
    let intro = "";
    let kind = "";
    let wordCount = "";
    let bookUrl = "";

    // 判断是否为 HTML 节点（来自 parseHtmlElements，有 rawAttrs 属性）
    const isHtmlNode = (item as any).rawAttrs !== undefined;
    if (isHtmlNode) {
      // HTML 模式：使用 extractTextFromHtml
      const nodeHtml = (item as any).html || "";
      const nodeAttrs = (item as any).attrs || {};
      // 辅助：提取属性（兼容纯属性名如 "href"、"src"，支持 || 回退）
      const extractAttr = (rule: string, defaultAttr: string): string => {
        console.log(`[extractAttr] called: rule=${rule}, defaultAttr=${defaultAttr}`);
        const parts = splitTopLevel(rule, ["||"]).parts.map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          const r = part.trim();
          // 如果是纯属性名（无空格、不以 . # [ @ 开头），直接从 attrs 取
          if (r && !r.includes(" ") && !r.startsWith(".") && !r.startsWith("#") && !r.startsWith("[") && !r.includes("@")) {
            const val = nodeAttrs[r.toLowerCase()] || "";
            if (val) return val;
          } else {
            // 否则用 extractTextFromHtml（支持 @attr 语法）
            const res = extractTextFromHtml(nodeHtml, r || defaultAttr);
            if (res) return res;
          }
        }
        console.log(`[extractAttr] rule=${rule}, attrs=`, JSON.stringify(nodeAttrs));
        return "";
      };
      name = extractAttr(ruleSearch.name, "text") || (item as any).text || "";
      author = extractAttr(ruleSearch.author, "text") || "未知作者";
      bookUrl = extractAttr(ruleSearch.bookUrl, "href") || "";
      coverUrl = extractAttr(ruleSearch.coverUrl, "src") || "";
      intro = extractAttr(ruleSearch.intro, "text") || "";
      kind = extractAttr(ruleSearch.kind, "") || "网络小说";
      wordCount = extractAttr(ruleSearch.wordCount, "") || "";
    } else {
      // JSON 模式：优先直接属性，JSONPath 兜底
      name = String(item.title || item.name || jsonpathFirstString(item, ruleSearch.name || "$.title") || "").trim();
      author = String(item.author || item.writer || jsonpathFirstString(item, ruleSearch.author || "$.author") || "").trim() || "未知作者";
      coverUrl = String(item.coverImg || item.cover || item.img || jsonpathFirstString(item, ruleSearch.coverUrl || "$.cover") || "").trim();
      intro = String(item.desc || item.intro || jsonpathFirstString(item, ruleSearch.intro || "$.desc") || "").trim();
      kind = String(item.category || jsonpathFirstString(item, ruleSearch.kind || "$.category") || "网络小说").trim();
      wordCount = String(item.word || jsonpathFirstString(item, ruleSearch.wordCount || "$.word") || "").trim();

      const template = ruleSearch.bookUrl || "$.bookUrl";
      if (template.includes("{{")) {
        const regex = /\{\{([\s\S]*?)\}\}/g;
        bookUrl = template;
        let bm;
        while ((bm = regex.exec(template)) !== null) {
          const expr = bm[1].trim();
          let val = "";
          if (expr.startsWith("$.") || expr.startsWith("$..") || expr === "$") {
            val = String(jsonpathFirstString(item, expr) ?? "");
          } else if (expr.includes("source.getKey()") || expr.includes("java.")) {
            const jsRes = await executeLegadoJs(expr, { source, baseUrl, result: item });
            val = String(jsRes ?? "");
          } else {
            val = String(item[expr] ?? "");
          }
          bookUrl = bookUrl.replace(bm[0], val);
        }
      } else {
        bookUrl = String(jsonpathFirstString(item, template) || item.bookUrl || item.url || "").trim();
      }
    }

    if (!name) continue;
    if (bookUrl.startsWith("//")) {
      bookUrl = `${new URL(baseDomain).protocol}${bookUrl}`;
    } else if (bookUrl.startsWith("/")) {
      bookUrl = `${baseDomain}${bookUrl}`;
    }

    books.push({
      name,
      author,
      bookUrl: bookUrl || `${baseUrl}#${name}`,
      origin: source.bookSourceUrl || baseUrl,
      originName: source.bookSourceName || "网络书源",
      coverUrl,
      intro,
      kind,
      wordCount
    });
  }

  return books;
}

// ==========================================
// 11. Book Info Parsing
// ==========================================

export interface ParsedBookInfo {
  name?: string;
  author?: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  updateTime?: string;
  tocUrl?: string;
  canRename?: boolean;
  downloadUrls?: string[];
}

export async function parseBookInfoWithRules(
  rawText: string,
  source: any,
  baseUrl: string,
  bookUrl: string
): Promise<ParsedBookInfo> {
  const ruleBookInfo = source?.ruleBookInfo || {};
  const info: ParsedBookInfo = {};

  let data: any = null;
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { data = JSON.parse(trimmed); } catch {}
  }

  const extractField = async (rule: string | undefined, defaultSelector: string): Promise<string> => {
    if (!rule) return "";
    if (rule.includes("@js:")) {
      const [fieldRule, jsPart] = rule.split("@js:");
      let rawVal = "";
      if (data) {
        rawVal = jsonpathFirstString(data, fieldRule.trim()) || "";
      } else {
        const nodes = parseHtmlElements(rawText, fieldRule.trim() || defaultSelector);
        rawVal = nodes[0]?.text || nodes[0]?.attrs[defaultSelector.includes("@") ? defaultSelector.split("@")[1] : "href"] || "";
      }
      const res = await executeLegadoJs(jsPart, { source, baseUrl, result: String(rawVal) });
      return String(res ?? "");
    }
    if (rule.startsWith("$.") || rule.startsWith("$..") || rule === "$") {
      if (data) return jsonpathFirstString(data, rule) || "";
    }
    const nodes = parseHtmlElements(rawText, rule || defaultSelector);
    return nodes[0]?.text || nodes[0]?.attrs["href"] || nodes[0]?.attrs["src"] || "";
  };

  info.name = await extractField(ruleBookInfo.name, "h1@text");
  info.author = await extractField(ruleBookInfo.author, ".author@text");
  info.coverUrl = await extractField(ruleBookInfo.coverUrl, "img@src");
  info.intro = await extractField(ruleBookInfo.intro, ".intro@text");
  info.kind = await extractField(ruleBookInfo.kind, ".kind@text");
  info.wordCount = await extractField(ruleBookInfo.wordCount, ".wordCount@text");
  info.lastChapter = await extractField(ruleBookInfo.lastChapter, ".lastChapter@text");
  info.updateTime = await extractField(ruleBookInfo.updateTime, ".updateTime@text");

  if (ruleBookInfo.tocUrl) {
    if (data) {
      info.tocUrl = jsonpathFirstString(data, ruleBookInfo.tocUrl) || "";
    } else {
      const nodes = parseHtmlElements(rawText, ruleBookInfo.tocUrl);
      info.tocUrl = resolveUrl(baseUrl, nodes[0]?.attrs["href"] || nodes[0]?.text || "");
    }
  }

  if (ruleBookInfo.canRename) {
    info.canRename = true;
  }

  if (ruleBookInfo.downloadUrls) {
    if (data) {
      const urls = jsonpathQuery(data, ruleBookInfo.downloadUrls);
      if (Array.isArray(urls)) info.downloadUrls = urls.map(u => String(u)).filter(Boolean);
    }
  }

  return info;
}

// ==========================================
// 12. Login Check
// ==========================================

export interface LoginCheckResult {
  needLogin: boolean;
  loginUrl?: string;
  cookies?: Record<string, string>;
}

export async function checkLoginWithRules(
  rawText: string,
  source: any,
  baseUrl: string
): Promise<LoginCheckResult> {
  const result: LoginCheckResult = { needLogin: false };

  if (source?.login_check_js) {
    try {
      const jsRes = await executeLegadoJs(source.login_check_js, {
        source,
        baseUrl,
        result: rawText,
      });
      if (jsRes === true || jsRes === "true" || jsRes === 1) {
        result.needLogin = true;
      }
    } catch {}
  }

  if (source?.login_ui || source?.loginUrl) {
    result.needLogin = true;
    result.loginUrl = source.loginUrl || source.login_ui;
  }

  if (!result.needLogin) {
    const lowerText = rawText.toLowerCase();
    if (
      lowerText.includes("登录") ||
      lowerText.includes("login") ||
      lowerText.includes("sign in") ||
      lowerText.includes("未登录") ||
      lowerText.includes("请先登录")
    ) {
      const loginForms = parseHtmlElements(rawText, "form[action*='login'], form[action*='signin']");
      if (loginForms.length > 0) {
        result.needLogin = true;
      }
    }
  }

  return result;
}

// ==========================================
// 正则直接提取（Legado 兼容）：纯正则规则从 HTML 提取正文
// 支持格式：regex##$group##replace
// ==========================================
function extractContentByRegex(html: string, regexRule: string): string | null {
  const parts = splitTopLevel(regexRule, ["##"]);
  const pattern = parts.parts[0];
  const groupRef = parts.parts[1] || "$0";
  const replaceWith = parts.parts[2] || "";

  try {
    const re = new RegExp(pattern, "g");
    const match = re.exec(html);
    if (!match) return null;
    // 解析 groupRef：支持 "$0", "$1", 或者直接数字 "0", "1"
    const g = String(groupRef);
    const groupIndex = g.startsWith("$") ? parseInt(g.substring(1), 10) : parseInt(g, 10);
    let raw = groupIndex !== undefined && match[groupIndex] !== undefined
      ? match[groupIndex]
      : match[0] || "";
    if (replaceWith) {
      raw = raw.replace(new RegExp(pattern, "g"), replaceWith);
    }
    return raw.trim() || null;
  } catch {
    return null;
  }
}

// ==========================================
// 13. Content Parsing (parseContentWithRules)
// ==========================================

export async function parseContentWithRules(
  rawText: string,
  source: any,
  chapterUrl: string
): Promise<string> {
  const ruleContent = source?.ruleContent || {};
  const rawRule = ruleContent.content;

  let contentRules: string[];
  if (Array.isArray(rawRule)) {
    contentRules = rawRule.map(String).filter(Boolean);
  } else if (typeof rawRule === "string") {
    contentRules = [rawRule.trim()];
  } else {
    contentRules = ["$..content"];
  }

  for (const contentRule of contentRules) {
    const trimmed = contentRule.trim();
    if (!trimmed) continue;

    // 分割 || 为回退规则（Legado 语义：按顺序尝试，取第一个非空结果）
    const subRules = splitTopLevel(trimmed, ["||"]).parts.map((s) => s.trim()).filter(Boolean);

    let body: string | null = null;
    let usedRule = "";

    for (const subRule of subRules) {
      // 分割第一个 ## 为选择器 + inline replaceRegex（选择器##要移除的文本）
      const srParts = splitTopLevel(subRule, ["##"]).parts;
      const selectorPart = srParts[0] || "";
      const inlineRemove = srParts[1] || "";
      const cssRule = selectorPart.split("@js:")[0];

      let subBody: string | null = null;

      // A. JSON 模式：响应为 JSON 时用 JSONPath 提取
      if ((rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) && !cssRule.startsWith("<")) {
        try {
          const j = JSON.parse(rawText);
          const extracted = jsonpathQuery(j, cssRule);
          if (extracted && extracted.length > 0) {
            subBody = extracted.join("\n");
          }
        } catch {}
      }

      // B. CSS 选择器模式
      if (!subBody && cssRule && !cssRule.startsWith("<")) {
        const extracted = extractTextFromHtml(rawText, cssRule || "#content@html");
        if (extracted) subBody = extracted;
      }

      // C. 正则直接提取模式（兜底）
      if (!subBody) {
        subBody = extractContentByRegex(rawText, subRule);
      }

      if (!subBody) continue;

      body = subBody;
      usedRule = subRule;

      // 应用 inline replaceRegex（移除匹配文本），按行应用避免贪婪正则跨行
      if (inlineRemove) {
        try {
          const re = new RegExp(inlineRemove, "g");
          body = body.split("\n").map((line) => line.replace(re, "")).join("\n");
        } catch {}
      }

      break; // 使用第一个成功的回退规则
    }

    if (!body) continue;

    // 后续通用处理：AES 解密
    if (usedRule.includes("java.aesBase64DecodeToString")) {
      const match = usedRule.match(
        /java\.aesBase64DecodeToString\s*\(\s*([^,]+)\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/
      );
      if (match) {
        try {
          const key = new TextEncoder().encode(match[2]);
          const iv = new TextEncoder().encode(match[4]);
          const dec = await aesDecryptCbc(body, key, iv);
          body = new TextDecoder().decode(dec);
          return body;
        } catch (err: any) {
          console.warn("Direct aesBase64DecodeToString error:", err.message);
        }
      }
    }

    // @js: 处理
    if (usedRule.includes("@js:")) {
      const jsPart = usedRule.split("@js:")[1];
      const jsRes = await executeLegadoJs(jsPart, {
        source,
        baseUrl: chapterUrl,
        result: body,
      });
      if (jsRes) body = String(jsRes);
    }

    // formatJs 处理
    if (ruleContent.formatJs) {
      const jsRes = await executeLegadoJs(ruleContent.formatJs, {
        source,
        baseUrl: chapterUrl,
        result: body,
      });
      if (jsRes) body = String(jsRes);
    }

    // imageStyle: "FULL" —— 保留图片 URL（在 stripHtml 之前对 HTML 预处理）
    if (ruleContent.imageStyle === "FULL" && body) {
      body = body.replace(/<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_match, src) => {
        return `\n[图片](${src})\n`;
      });
    }

    // 清理 HTML 标签和实体（如 @all 提取器返回的原始 HTML）
    body = stripHtml(body);

    // replaceRegex 处理（独立字段）——在 stripHtml 之后对纯文本操作，按行应用避免贪婪正则跨行吞掉整个正文
    if (ruleContent.replaceRegex) {
      try {
        const parts = splitTopLevel(ruleContent.replaceRegex, ["##"]).parts;
        if (parts.length >= 2) {
          let repPattern = parts[0];
          let repWith = parts[1] || "";
          if (!repPattern && repWith) {
            repPattern = repWith;
            repWith = "";
          }
          const re = new RegExp(repPattern, "g");
          body = body
            .split("\n")
            .map((line) => line.replace(re, repWith))
            .join("\n");
        }
      } catch {}
    }

    return body;
  }

  return "";
}

// 清理 HTML：将块级标签转为换行，移除所有标签，解码 HTML 实体
function stripHtml(html: string): string {
  if (!html) return "";
  let s = html;
  // 块级/换行标签转为换行
  s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  s = s.replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote|pre|section|article)\s*>/gi, "\n");
  // 移除所有剩余 HTML 标签
  s = s.replace(/<[^>]*>/g, "");
  // 解码常见 HTML 实体
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  // 压缩多个连续空行，但保留段落间的空行
  s = s.replace(/\n{3,}/g, "\n\n");
  // 压缩多个连续空格为单个空格（保留换行）
  s = s.replace(/[ \t]{2,}/g, " ");
  return s;
}

// ==========================================
// 纯 JS AES-CBC 实现（供 Legado JS 沙箱同步调用，Web Crypto 是异步的）
// ==========================================

const AES_SBOX: number[] = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0x3d,0xdc,
  0x08,0x80,0x5d,0x5f,0x66,0x77,0x1b,0xdd,0x8a,0x24,0xbf,0xee,0xa9,0x99,0x0d,0x6b,
  0x3a,0x9e,0x32,0xc8,0x37,0x15,0x5b,0xe3,0x4e,0x08,0x2d,0x92,0x9b,0x6c,0x8e,0x7e,
  0x0b,0xa7,0xf9,0x4f,0xd3,0x2e,0x8e,0x5c,0x8d,0x11,0x3f,0x0e,0x34,0x88,0x7b,0x04,
  0x29,0xe6,0x4d,0x06,0x68,0x57,0x48,0x76,0x3d,0xa7,0x02,0xe1,0x4c,0xc8,0x3a,0xbb,
  0x47,0xe2,0x6a,0x79,0x96,0x8a,0x9d,0xba,0x2c,0xc3,0x8e,0xd3,0x52,0xe8,0x4f,0xed,
  0xcb,0x0f,0x4b,0x2e,0x93,0x1a,0xd2,0xf3,0x35,0xe3,0xd7,0xc2,0x94,0x8f,0x4b,0xc1,
  0x3c,0x12,0xd8,0x7f,0x9d,0x62,0xfe,0x2a,0x15,0x4c,0x7e,0xe8,0x63,0x9f,0xe5,0x1b,
  0xd4,0x3b,0x73,0x9c,0x40,0xa1,0xc3,0x0c,0x0e,0xe4,0x84,0x72,0x0d,0x47,0xf5,0x8d,
];

const AES_INV_SBOX: number[] = [
  0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
  0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
  0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
  0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8d,0x32,0xc8,
  0xa6,0xdc,0xf9,0x69,0x8b,0x36,0x3f,0xc6,0x8f,0x6a,0x4a,0x3c,0xb2,0xcc,0x62,0x00,
  0x9c,0xb4,0x4d,0xef,0x0c,0x27,0xf9,0xf4,0x81,0x3b,0x7b,0xfc,0xa8,0x5d,0x7d,0x1a,
  0x4c,0x6a,0x36,0x8b,0x55,0xdc,0x63,0x3c,0xa4,0xee,0x00,0x0f,0x9b,0x76,0x8d,0x69,
  0x4d,0x1a,0x92,0xce,0x45,0xfc,0x2e,0x1e,0x51,0x02,0x75,0x2c,0x0b,0x0f,0x3d,0x8f,
  0xed,0x68,0x3f,0xbc,0x2f,0x36,0xd9,0xc2,0xb5,0x07,0x77,0x2a,0xad,0x67,0xd2,0x29,
  0xfd,0x86,0xca,0x8c,0x9b,0x30,0x28,0xa6,0x19,0x88,0xba,0xae,0xe7,0x4f,0xc6,0x1d,
  0xda,0x16,0x02,0x0a,0x87,0x38,0xb2,0x3d,0x0d,0x31,0x26,0xb0,0x85,0xea,0x20,0x89,
  0xb9,0x98,0x0f,0xd3,0xff,0xa5,0x24,0x23,0x4a,0xc7,0xd6,0xf5,0x35,0xdc,0x79,0xc5,
  0x70,0xf8,0x2c,0xd8,0xe3,0x09,0x2e,0x7b,0x51,0xdd,0x2b,0xe0,0xac,0x91,0x56,0xf1,
  0x6c,0x72,0xd0,0x90,0x7c,0x52,0x08,0x54,0x60,0x1f,0x17,0xa0,0x96,0x3a,0xfc,0x47,
  0x50,0x64,0x8f,0x00,0x82,0xd5,0x66,0x32,0xa9,0x33,0x7e,0x4d,0x22,0x41,0x4b,0x71,
  0x48,0xf6,0x1e,0xab,0x39,0x6a,0xa1,0x94,0x7f,0xa8,0x04,0x3b,0x74,0x11,0x3e,0x1a,
  0x8d,0x65,0x13,0xb3,0xde,0xf3,0x8b,0xfa,0xc9,0x80,0x21,0x53,0x75,0xb4,0xcd,0x18,
  0xa7,0x5d,0x01,0xb8,0xc4,0x81,0x6d,0x42,0x93,0x27,0x55,0x83,0x1c,0xf0,0x78,0xaa,
  0x84,0x92,0x6b,0x06,0xcb,0xfb,0x25,0x4e,0xef,0x5f,0x7d,0x61,0x6e,0x73,0xf4,0x1b,
  0x9d,0xb6,0x8a,0x45,0xe9,0xd7,0xd1,0xc3,0x9c,0xec,0x0c,0x99,0xdf,0xe6,0x5a,0xbe,
  0x15,0xa4,0xaf,0xe4,0x8e,0x40,0x5b,0x4c,0xe5,0x12,0x69,0xeb,0xf9,0xf2,0xdb,0xb7,
  0x5e,0xd4,0xc1,0xf7,0x34,0xbf,0x76,0xee,0x2d,0xb1,0xe1,0xc8,0xe2,0x97,0x9a,0x6f,
  0x57,0xcc,0x03,0x05,0x44,0x9e,0x49,0x0b,0x9f,0x59,0x63,0x3c,0xe8,0xce,0xfe,0x0e,
  0x46,0x5c,0xbd,0x58,0x43,0xa3,0xa2,0x95,0x7a,0x10,0x14,0xbb,0x37,0xcf,0xc0,0x62,
];

const AES_RCON: number[] = [
  0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b,
];

function aesSubWord(word: number[]): number[] {
  return [AES_SBOX[word[0] & 0xff], AES_SBOX[word[1] & 0xff], AES_SBOX[word[2] & 0xff], AES_SBOX[word[3] & 0xff]];
}

function aesRotWord(word: number[]): number[] {
  return [word[1], word[2], word[3], word[0]];
}

function aesXor(a: number[], b: number[]): number[] {
  return [a[0] ^ b[0], a[1] ^ b[1], a[2] ^ b[2], a[3] ^ b[3]];
}

function aesKeyExpansion(key: number[]): number[][] {
  const Nk = key.length / 4;
  const Nr = Nk + 6;
  const w: number[][] = [];
  let i = 0;
  while (i < Nk) {
    w.push([key[i * 4], key[i * 4 + 1], key[i * 4 + 2], key[i * 4 + 3]]);
    i++;
  }
  i = Nk;
  while (i < 4 * (Nr + 1)) {
    let temp = w[i - 1];
    if (i % Nk === 0) {
      temp = aesXor(aesSubWord(aesRotWord(temp)), [AES_RCON[i / Nk], 0, 0, 0]);
    } else if (Nk > 6 && i % Nk === 4) {
      temp = aesSubWord(temp);
    }
    w.push(aesXor(w[i - Nk], temp));
    i++;
  }
  return w;
}

function aesAddRoundKey(state: number[][], roundKey: number[][]): void {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      state[r][c] ^= roundKey[c][r];
}

function aesSubBytes(state: number[][], sbox: number[]): void {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      state[r][c] = sbox[state[r][c] & 0xff];
}

function aesShiftRows(state: number[][], inverse: boolean): void {
  const tmp: number[][] = [];
  for (let r = 0; r < 4; r++) tmp.push([...state[r]]);
  for (let r = 1; r < 4; r++) {
    const shift = inverse ? (4 - (r % 4)) : r;
    for (let c = 0; c < 4; c++) state[r][c] = tmp[r][(c + shift) % 4];
  }
}

function aesMixColumns(state: number[][], inverse: boolean): void {
  for (let c = 0; c < 4; c++) {
    const a = [state[0][c], state[1][c], state[2][c], state[3][c]];
    if (!inverse) {
      state[0][c] = gfMul(2, a[0]) ^ gfMul(3, a[1]) ^ a[2] ^ a[3];
      state[1][c] = a[0] ^ gfMul(2, a[1]) ^ gfMul(3, a[2]) ^ a[3];
      state[2][c] = a[0] ^ a[1] ^ gfMul(2, a[2]) ^ gfMul(3, a[3]);
      state[3][c] = gfMul(3, a[0]) ^ a[1] ^ a[2] ^ gfMul(2, a[3]);
    } else {
      state[0][c] = gfMul(0xe, a[0]) ^ gfMul(0xb, a[1]) ^ gfMul(0xd, a[2]) ^ gfMul(0x9, a[3]);
      state[1][c] = gfMul(0x9, a[0]) ^ gfMul(0xe, a[1]) ^ gfMul(0xb, a[2]) ^ gfMul(0xd, a[3]);
      state[2][c] = gfMul(0xd, a[0]) ^ gfMul(0x9, a[1]) ^ gfMul(0xe, a[2]) ^ gfMul(0xb, a[3]);
      state[3][c] = gfMul(0xb, a[0]) ^ gfMul(0xd, a[1]) ^ gfMul(0x9, a[2]) ^ gfMul(0xe, a[3]);
    }
  }
}

function gfMul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function aesStateToBytes(state: number[][]): number[] {
  const out: number[] = [];
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out.push(state[r][c]);
  return out;
}

function aesBytesToState(bytes: number[]): number[][] {
  const state: number[][] = [[], [], [], []];
  for (let i = 0; i < 16; i++) state[i % 4][Math.floor(i / 4)] = bytes[i];
  return state;
}

function aesDecryptBlock(input: number[], keySchedule: number[][]): number[] {
  const state = aesBytesToState(input);
  const Nr = keySchedule.length / 4 - 1;
  aesAddRoundKey(state, keySchedule.slice(4 * Nr));
  aesShiftRows(state, true);
  aesSubBytes(state, AES_INV_SBOX);
  for (let round = Nr - 1; round > 0; round--) {
    aesAddRoundKey(state, keySchedule.slice(4 * round, 4 * (round + 1)));
    aesMixColumns(state, true);
    aesShiftRows(state, true);
    aesSubBytes(state, AES_INV_SBOX);
  }
  aesAddRoundKey(state, keySchedule.slice(0, 4));
  return aesStateToBytes(state);
}

function aesCbcDecrypt(data: number[], key: number[], iv: number[]): number[] {  const keySchedule = aesKeyExpansion(key);
  const blockSize = 16;
  const result: number[] = [];
  let prev = iv;
  for (let i = 0; i < data.length; i += blockSize) {
    const block = data.slice(i, i + blockSize);
    const decrypted = aesDecryptBlock(block, keySchedule);
    for (let j = 0; j < blockSize; j++) result.push(decrypted[j] ^ prev[j]);
    prev = block;
  }
  // PKCS5Padding 去填充
  if (result.length > 0) {
    const pad = result[result.length - 1];
    if (pad >= 1 && pad <= blockSize) {
      let ok = true;
      for (let j = 1; j <= pad; j++) {
        if (result[result.length - j] !== pad) { ok = false; break; }
      }
      if (ok) result.length -= pad;
    }
  }
  return result;
}

async function aesDecryptCbcRaw(data: number[], key: number[], iv: number[]): Promise<number[]> {
  const keyBuffer = new Uint8Array(key).buffer;
  const ivBuffer = new Uint8Array(iv).buffer;
  const dataBuffer = new Uint8Array(data).buffer;
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer, { name: "AES-CBC" }, false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBuffer }, cryptoKey, dataBuffer);
  return Array.from(new Uint8Array(decrypted));
}

function bytesToStr(bytes: number[]): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function strToBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  return bytes;
}

function base64ToBytes(str: string): number[] {
  const bin = atob(String(str));
  const bytes: number[] = [];
  for (let i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
  return bytes;
}

