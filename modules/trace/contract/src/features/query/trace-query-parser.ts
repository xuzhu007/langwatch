/**
 * Query-language parsing: wraps liqe with normalisation, LRU caching, and
 * post-processing fixes (liqe's serializer occasionally emits unparseable output).
 */

import {
  type LiqeQuery,
  SyntaxError as LiqeSyntaxError,
  parse as liqeParse,
  serialize as liqeRawSerialize,
} from "liqe";

export type {
  LiqeQuery,
  LogicalExpressionToken,
  ParenthesizedExpressionToken,
  TagToken,
  UnaryOperatorToken,
} from "liqe";

/** Parse already-normalised query syntax without applying browser editor affordances. */
export function parseTraceQuerySyntax(query: string): LiqeQuery {
  return parseWithApostrophes(query);
}

/** A private-use character absent from `query`, standing in for an in-word apostrophe. */
function standInFor(query: string): string {
  let code = 0xe000;
  while (query.includes(String.fromCharCode(code))) code += 1;
  return String.fromCharCode(code);
}
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Whether the `'` at `index` belongs to a word (doesn't, member's, members')
 * rather than opening or closing a single-quoted value. Outside quotes it
 * follows a letter or digit; inside one it also has one on its right.
 */
function isWordApostrophe({
  text,
  index,
  inSingleQuotes,
}: {
  text: string;
  index: number;
  inSingleQuotes: boolean;
}): boolean {
  if (text.charAt(index) !== "'") return false;
  const before = WORD_CHAR.test(text.charAt(index - 1));
  if (!inSingleQuotes) return before;
  return before && WORD_CHAR.test(text.charAt(index + 1));
}

function maskWordApostrophes({ text, standIn }: { text: string; standIn: string }): string {
  let out = "";
  let quoteChar = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\\" && quoteChar) {
      out += ch + text.charAt(i + 1);
      i += 1;
      continue;
    }
    if (isWordApostrophe({ text, index: i, inSingleQuotes: quoteChar === "'" })) {
      out += quoteChar === '"' ? ch : standIn;
      continue;
    }
    quoteChar = nextQuoteChar({ ch, quoteChar });
    out += ch;
  }
  return out;
}

function nextQuoteChar({ ch, quoteChar }: { ch: string; quoteChar: string }): string {
  if (ch !== '"' && ch !== "'") return quoteChar;
  if (!quoteChar) return ch;
  return ch === quoteChar ? "" : quoteChar;
}

function restoreApostrophes<T>({ node, standIn }: { node: T; standIn: string }): T {
  if (typeof node === "string") return node.replaceAll(standIn, "'") as T;
  if (Array.isArray(node))
    return node.map((item) => restoreApostrophes({ node: item, standIn })) as T;
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = restoreApostrophes({ node: record[key], standIn });
    }
  }
  return node;
}

/** liqe, reading an in-word apostrophe as a letter. @see specs/traces-v2/search.feature */
function parseWithApostrophes(query: string): LiqeQuery {
  const standIn = standInFor(query);
  const masked = maskWordApostrophes({ text: query, standIn });
  const ast = parseLiqe(masked);
  return masked === query ? ast : restoreApostrophes({ node: ast, standIn });
}

/**
 * Fix liqe serializer output that its own parser rejects (missing space after
 * `]`/`)` before boolean ops, stray whitespace in parens). Normalise
 * post-serialisation while preserving quoted strings.
 */
function splitOnQuotes(s: string): { text: string; quoted: boolean }[] {
  const segments: { text: string; quoted: boolean }[] = [];
  let buf = "";
  let quoteChar = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (quoteChar) {
      buf += ch;
      const inWord = isWordApostrophe({ text: s, index: i, inSingleQuotes: quoteChar === "'" });
      if (ch === quoteChar && s[i - 1] !== "\\" && !inWord) {
        segments.push({ text: buf, quoted: true });
        buf = "";
        quoteChar = "";
      }
    } else if (
      (ch === '"' || ch === "'") &&
      !isWordApostrophe({ text: s, index: i, inSingleQuotes: false })
    ) {
      if (buf) {
        segments.push({ text: buf, quoted: false });
      }
      buf = ch;
      quoteChar = ch;
    } else {
      buf += ch;
    }
  }
  if (buf) {
    segments.push({ text: buf, quoted: quoteChar !== "" });
  }
  return segments;
}

function normalizeQueryString(s: string): string {
  return splitOnQuotes(s)
    .map((seg) =>
      seg.quoted
        ? seg.text
        : seg.text
            .replace(/([)\]])(?=(?:AND|OR|NOT)\b)/gi, "$1 ")
            .replace(/\b(?:AND|OR|NOT)\b\s+/gi, (m) => m.replace(/\s+/g, " "))
            // Collapse whitespace immediately inside parens — `( a` / `a )`
            // are serializer artifacts from clause removal, never canonical.
            .replace(/\(\s+/g, "(")
            .replace(/\s+\)/g, ")")
            .replace(/[ \t]{2,}/g, " "),
    )
    .join("")
    .trim();
}

export function serialize(ast: LiqeQuery): string {
  return normalizeQueryString(liqeRawSerialize(ast));
}

export const EMPTY_AST: LiqeQuery = {
  type: "EmptyExpression",
  location: { start: 0, end: 0 },
};

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly position?: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

const TOKEN_START_PRECEDERS = new Set([" ", "\t", "\n", "("]);

/**
 * Strip @ sigil and normalise NBSP. Both are silent failures: liqe rejects @
 * in field positions, treats NBSP as non-whitespace. Preserve quoted strings.
 */
export function stripAtSigils(text: string): string {
  // Replace any NBSP with regular space first — uniform treatment from
  // here on, and the @-strip pass needs to see the post-replacement chars.
  const normalized = text.replace(/\u00A0/g, " ");
  let out = "";
  let quoteChar = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charAt(i);
    if (quoteChar !== "") {
      out += ch;
      const closes =
        ch === quoteChar &&
        !isWordApostrophe({ text: normalized, index: i, inSingleQuotes: quoteChar === "'" });
      quoteChar = closes ? "" : quoteChar;
      continue;
    }
    if (
      (ch === '"' || ch === "'") &&
      !isWordApostrophe({ text: normalized, index: i, inSingleQuotes: false })
    ) {
      out += ch;
      quoteChar = ch;
      continue;
    }
    if (startsAToken(normalized, i)) {
      continue;
    }
    out += ch;
  }
  return out;
}

/** Whether the `@` at `index` opens a token, and so is the sigil rather than part of a value. */
function startsAToken(normalized: string, index: number): boolean {
  if (normalized.charAt(index) !== "@") return false;
  const prev = index === 0 ? void 0 : normalized[index - 1];

  return prev === void 0 || TOKEN_START_PRECEDERS.has(prev);
}

// Tiny LRU around `parse`. Per keystroke the SearchBar parses twice — once
// in `filterStore.applyQueryText` and once in the `filterHighlight`
// ProseMirror plugin. They pass the same raw text, so caching the last few
// inputs collapses both calls into a single liqe pass.
type ParseEntry = { ok: true; ast: LiqeQuery } | { ok: false; error: ParseError };
const PARSE_CACHE_LIMIT = 8;
const parseCache = new Map<string, ParseEntry>();

function findCachedParse(key: string): ParseEntry | undefined {
  const entry = parseCache.get(key);
  if (!entry) {
    return void 0;
  }
  // Refresh recency.
  parseCache.delete(key);
  parseCache.set(key, entry);
  return entry;
}

function cacheSet(key: string, entry: ParseEntry): void {
  if (parseCache.size >= PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== void 0) {
      parseCache.delete(oldest);
    }
  }
  parseCache.set(key, entry);
}

export function parse(query: string): LiqeQuery {
  const trimmed = stripAtSigils(query).trim();
  if (trimmed.length === 0) {
    return EMPTY_AST;
  }
  const hit = findCachedParse(trimmed);
  if (hit) {
    if (hit.ok) {
      return hit.ast;
    }
    throw hit.error;
  }
  try {
    const ast = parseWithApostrophes(trimmed);
    cacheSet(trimmed, { ok: true, ast });
    return ast;
  } catch (e) {
    const error =
      e instanceof LiqeSyntaxError
        ? new ParseError(e.message, e.offset)
        : new ParseError("Invalid query syntax — check for unmatched quotes or parentheses.");
    cacheSet(trimmed, { ok: false, error });
    throw error;
  }
}

export function isEmptyAST(ast: LiqeQuery): boolean {
  return ast.type === "EmptyExpression";
}

const VALUE_COLON_PLACEHOLDER = "\uE000";

/** 一个条件：引号串整体算一段（可未闭合），空白和括号是分隔符。 */
const CLAUSE_RE = /(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s()"'])+/g;

/**
 * 不含引号的 `field:value`。值以 `[` `{` `/` `>` `<` `=` 开头时是范围、正则
 * 或比较写法，交给 liqe 自己处理。
 */
const UNQUOTED_TAG_RE = /^([^:"']+:)([^"'[{/<>=][^"']*)$/;

/**
 * liqe 只把第一个冒号当字段分隔符，未加引号的值里再出现 `:` 就报
 * `Syntax error`，例如 `label:team:xiaohai-product-support-entry`。标签等
 * 取值本身常带冒号，所以把每个条件字段之后的冒号换成占位符。
 */
function maskValueColons(text: string): string {
  return text.replace(CLAUSE_RE, (clause) =>
    clause.replace(
      UNQUOTED_TAG_RE,
      (_match, field: string, value: string) =>
        `${field}${value.replaceAll(":", VALUE_COLON_PLACEHOLDER)}`,
    ),
  );
}

function unmaskValueColons(node: LiqeQuery): void {
  switch (node.type) {
    case "Tag": {
      const expression = node.expression;
      if ("value" in expression && typeof expression.value === "string") {
        expression.value = expression.value.replaceAll(VALUE_COLON_PLACEHOLDER, ":");
      }
      return;
    }
    case "LogicalExpression":
      unmaskValueColons(node.left);
      unmaskValueColons(node.right);
      return;
    case "UnaryOperator":
      unmaskValueColons(node.operand);
      return;
    case "ParenthesizedExpression":
      unmaskValueColons(node.expression);
      return;
  }
}

/**
 * liqe 的 `parse`，额外允许未加引号的值中出现冒号。前端搜索栏与后端
 * ClickHouse 翻译都经由这里解析，保证两边对同一查询的理解一致。
 */
export function parseLiqe(text: string): LiqeQuery {
  if (text.includes(VALUE_COLON_PLACEHOLDER)) return liqeParse(text);
  const masked = maskValueColons(text);
  if (masked === text) return liqeParse(text);
  const ast = liqeParse(masked);
  unmaskValueColons(ast);
  return ast;
}
