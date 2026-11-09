#!/usr/bin/env node
// llm-wiki helper: the deterministic half of the llm-wiki skill. Claude reads sources and
// writes pages; this script does bookkeeping that must not depend on the model.
// Pattern: Andrej Karpathy's LLM Wiki, https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
// Layout is compatible with nashsu/llm_wiki: purpose.md, schema.md, raw/sources/, wiki/<type>/.
// Zero dependencies (Node >= 18). pdftotext (poppler) is used for PDFs when available.
//
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 StevenGuo42. Portions (source-page naming, index updates, delete cascade, the
// default schema template) are ported from LLM Wiki, Copyright (C) 2024-2026 Yong Su,
// https://github.com/nashsu/llm_wiki, GPL-3.0. See LICENSE.
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES = path.join(HERE, "..", "templates")
const MANIFEST = ".llm-wiki/skill-sources.json"
const AGGREGATES = new Set(["index", "log", "overview"])
const TEXT_EXT = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml", ".html", ".htm", ".xml", ".tex", ".rst", ".org"])
const RELATED = ["<!-- llm-wiki:related:start -->", "<!-- llm-wiki:related:end -->"]
const SOURCE_PAGES = ["<!-- llm-wiki:source-pages:start -->", "<!-- llm-wiki:source-pages:end -->"]

// ───────────────────────── frontmatter ─────────────────────────

export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return { fm: null, body: text, raw: "" }
  return { fm: m[1], body: text.slice(m[0].length), raw: m[0] }
}

// Scan an inline YAML array starting at `[`. A quote opens a string only at the start of an
// item (as in YAML), so `[koo's-view]` stays one plain item and `["Book [2nd ed].pdf"]` keeps
// its `]` (llm_wiki PR #834). Returns { items, end } where end is the index after `]`, or null.
export function scanInlineArray(s, start = s.indexOf("[")) {
  if (start < 0 || s[start] !== "[") return null
  const items = []
  let i = start + 1
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i++
    if (s[i] === "]") return { items, end: i + 1 }
    if (i >= s.length || s[i] === "\n") return null
    let item = ""
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i]
      let j = i + 1, closed = false
      while (j < s.length && s[j] !== "\n") {
        if (q === '"' && s[j] === "\\") { item += unescapeDq(s[j + 1]); j += 2; continue }
        if (s[j] === q) {
          if (q === "'" && s[j + 1] === "'") { item += "'"; j += 2; continue }
          closed = true; j++; break
        }
        item += s[j++]
      }
      if (!closed) return fallbackArray(s, start) // unterminated quote: old first-`]` behaviour
      i = j
      while (s[i] === " " || s[i] === "\t") i++
    } else {
      let j = i
      while (j < s.length && s[j] !== "," && s[j] !== "]" && s[j] !== "\n") j++
      item = s.slice(i, j).trim()
      i = j
    }
    items.push(item)
    if (s[i] === ",") { i++; continue }
    if (s[i] === "]") return { items, end: i + 1 }
    return null
  }
}

function unescapeDq(c) {
  return { n: "\n", t: "\t", '"': '"', "\\": "\\", "/": "/" }[c] ?? c ?? ""
}

function fallbackArray(s, start) {
  const end = s.indexOf("]", start)
  const nl = s.indexOf("\n", start)
  if (end < 0 || (nl >= 0 && nl < end)) return null
  const items = s.slice(start + 1, end).split(",").map((x) => unquote(x.trim())).filter(Boolean)
  return { items, end: end + 1 }
}

function unquote(v) {
  if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"') {
    try { return JSON.parse(v) } catch { return v.slice(1, -1) }
  }
  if (v.length >= 2 && v[0] === "'" && v.at(-1) === "'") return v.slice(1, -1).replace(/''/g, "'")
  return v
}

// Locate a top-level key in frontmatter text: { lineStart, valueStart, end } where end covers
// any indented block-list lines that belong to it.
function findKey(fm, key) {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*:`, "m")
  const m = re.exec(fm)
  if (!m) return null
  let end = fm.indexOf("\n", m.index)
  if (end < 0) end = fm.length
  // continuation lines: indented text or `- item` block-list entries
  while (end < fm.length) {
    const nextEnd = fm.indexOf("\n", end + 1)
    const line = fm.slice(end + 1, nextEnd < 0 ? fm.length : nextEnd)
    if (!/^[ \t]+\S|^-[ \t]/.test(line)) break
    end = nextEnd < 0 ? fm.length : nextEnd
  }
  return { lineStart: m.index, valueStart: m.index + m[0].length, end }
}

export function getField(fm, key) {
  if (fm == null) return undefined
  const loc = findKey(fm, key)
  if (!loc) return undefined
  const value = fm.slice(loc.valueStart, loc.end)
  const firstLine = value.split("\n")[0].trim()
  if (firstLine.startsWith("[")) {
    const arr = scanInlineArray(firstLine, 0)
    return arr ? arr.items.filter((x) => x !== "") : []
  }
  if (firstLine === "" || firstLine === "|" || firstLine === ">") {
    const items = value.split("\n").slice(1).map((l) => /^[ \t]*-[ \t]+(.*)$/.exec(l)).filter(Boolean)
    if (items.length) return items.map((m) => unquote(stripComment(m[1]).trim()))
    return firstLine === "" ? "" : value.split("\n").slice(1).map((l) => l.trim()).join(" ")
  }
  return unquote(stripComment(firstLine))
}

function stripComment(v) {
  if (v.startsWith('"') || v.startsWith("'")) return v
  const i = v.search(/[ \t]#/)
  return (i >= 0 ? v.slice(0, i) : v).trim()
}

export function getArray(fm, key) {
  const v = getField(fm, key)
  if (v == null || v === "") return []
  return Array.isArray(v) ? v : [v]
}

// Quote a scalar only when it would not read back as the same plain string (PR #836):
// colons, " #", leading indicators, booleans/null/numbers, surrounding spaces.
export function yamlScalar(v) {
  const s = String(v)
  if (s === "") return '""'
  const plainOk =
    !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) &&
    !/[\s]$/.test(s) &&
    !/: |:$| #|[\n\t]/.test(s) &&
    !/^(true|false|yes|no|on|off|null|~)$/i.test(s) &&
    !/^[-+]?(\.\d+|\d[\d_]*(\.\d*)?)([eE][-+]?\d+)?$/.test(s) &&
    !/^0x[0-9a-f]+$/i.test(s)
  if (plainOk || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return JSON.stringify(s)
}

// Slugs stay bare (`related: [a, b]`); anything else, e.g. file names in `sources`, is double-quoted.
function yamlArrayItem(v) {
  const s = String(v)
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(s) && yamlScalar(s) === s ? s : JSON.stringify(s)
}

// File names (`sources`) are always quoted, as llm_wiki writes them; slugs stay bare.
export const formatSources = (items) => `[${items.map((s) => JSON.stringify(String(s))).join(", ")}]`

export function formatArray(items) {
  return `[${items.map(yamlArrayItem).join(", ")}]`
}

// Replace (or append) a top-level key with a new rendered value. Splices instead of
// String.replace so `$&` in filenames stays literal (PR #834/#836).
export function setField(text, key, rendered) {
  const { fm, body } = splitFrontmatter(text)
  if (fm == null) return text
  const loc = findKey(fm, key)
  const line = `${key}: ${rendered}`
  const nextFm = loc ? fm.slice(0, loc.lineStart) + line + fm.slice(loc.end) : `${fm}\n${line}`
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  return `---${eol}${nextFm}${eol}---${eol}${body}`
}

// Best-effort strictness check, mirroring the failures that make llm_wiki's js-yaml parse fail.
export function frontmatterProblems(text) {
  const { fm } = splitFrontmatter(text)
  if (fm == null) return ["no frontmatter (first line must be ---)"]
  const problems = []
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line)
    if (!m) {
      if (line.trim() && !/^[ \t]/.test(line) && !/^-[ \t]/.test(line) && !line.startsWith("#")) problems.push(`unparseable line: ${line}`)
      continue
    }
    const [, key, v] = m
    if (!v) continue
    if (v.startsWith("[")) {
      if (/^\[\[/.test(v)) problems.push(`${key}: wikilinks in frontmatter arrays are invalid YAML; use bare slugs`)
      else if (!scanInlineArray(v, 0)) problems.push(`${key}: unterminated inline array`)
      continue
    }
    if (v.startsWith('"')) { if (!/^"(?:[^"\\]|\\.)*"[ \t]*(#.*)?$/.test(v)) problems.push(`${key}: bad double-quoted value`); continue }
    if (v.startsWith("'")) { if (!/^'(?:[^']|'')*'[ \t]*(#.*)?$/.test(v)) problems.push(`${key}: bad single-quoted value`); continue }
    if (/: /.test(v)) problems.push(`${key}: unquoted value contains ": " — wrap it in double quotes`)
    else if (/ #/.test(v) && ["title"].includes(key)) problems.push(`${key}: " #" starts a YAML comment — wrap the value in double quotes`)
  }
  return problems
}

// ───────────────────────── wikilinks ─────────────────────────

const WIKILINK = /(!?)\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g

export function linkKey(target) {
  const leaf = target.split("#")[0].trim().replace(/\\+$/, "").replace(/\\/g, "/").split("/").pop() // `[[a\|b]]` in tables
  return leaf.replace(/\.md$/i, "").toLowerCase()
}

// Code and math aren't links in Obsidian: `[[t_{j,0},t_{j,1}]]` inside $…$ is an interval.
// Inline math follows Obsidian's rule: no space just inside either `$`, and no newline.
export function stripCodeAndMath(text) {
  return text
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$(?=\S)[^$\n]*?\S\$|\$\S\$/g, "")
}

export function wikilinks(body) {
  const out = []
  for (const m of stripCodeAndMath(body).matchAll(WIKILINK)) {
    if (m[1]) continue // embeds (![[image.png]]) are attachments, not graph edges
    if (/\.(png|jpe?g|gif|svg|webp|pdf|mp4|mp3)$/i.test(m[2].split("#")[0])) continue
    out.push(linkKey(m[2]))
  }
  return out.filter(Boolean)
}

// Removes every marked block (an LLM merge can duplicate one) and any stray marker left behind.
function stripBlock(body, [start, end]) {
  let out = body
  for (;;) {
    const i = out.indexOf(start)
    const j = i < 0 ? -1 : out.indexOf(end, i)
    if (j < 0) break
    out = out.slice(0, i).trimEnd() + "\n" + out.slice(j + end.length).replace(/^\s*\n/, "")
  }
  out = out.split(start).join("").split(end).join("")
  return out === body ? body : out.trimEnd() + "\n"
}

// Unmarked text is never touched, even a "## Related" list. If an app merge strips our markers, the
// leftover links still count as linked, so no duplicate block is added; it becomes ordinary page text.
export function stripGenerated(body) {
  return stripBlock(stripBlock(body, RELATED), SOURCE_PAGES)
}

function putBlock(body, markers, content) {
  const base = stripBlock(body, markers)
  if (!content) return base
  return `${base.trimEnd()}\n\n${markers[0]}\n${content.trimEnd()}\n${markers[1]}\n`
}

// ───────────────────────── vault scanning ─────────────────────────

const toPosix = (p) => p.split(path.sep).join("/")

function walk(dir, filter, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { if (filter.dir(e.name, full)) walk(full, filter, out) }
    else if (filter.file(e.name, full)) out.push(full)
  }
  return out
}

export function loadPages(vault) {
  const wiki = path.join(vault, "wiki")
  const files = walk(wiki, {
    dir: (n) => !n.startsWith(".") && n !== "media",
    file: (n) => n.toLowerCase().endsWith(".md"),
  })
  return files.map((file) => {
    const text = fs.readFileSync(file, "utf8")
    const { fm, body } = splitFrontmatter(text)
    const stem = path.basename(file, path.extname(file))
    return {
      file,
      rel: toPosix(path.relative(vault, file)),
      stem,
      key: stem.toLowerCase(),
      text,
      fm,
      body,
      type: getField(fm, "type") || "",
      title: getField(fm, "title") || stem,
      sources: getArray(fm, "sources"),
      related: getArray(fm, "related").map(linkKey).filter(Boolean),
      aliases: getArray(fm, "aliases"),
    }
  })
}

function byKey(pages) {
  const map = new Map()
  for (const p of pages) {
    if (!map.has(p.key)) map.set(p.key, [])
    map.get(p.key).push(p)
  }
  return map
}

// ───────────────────────── sources ─────────────────────────

const sourcesRoot = (vault) => path.join(vault, "raw", "sources")

export function sourceKey(s) {
  return String(s).normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/\\/g, "/").replace(/^\.?\/+/, "").toLowerCase()
}

const baseKey = (s) => sourceKey(s).split("/").pop()

// A page cites a source when an entry equals its identity (path under raw/sources) or,
// like llm_wiki, when the entry is a bare file name equal to the source's file name.
export function citesSource(entry, identity) {
  const e = sourceKey(entry), id = sourceKey(identity)
  return e === id || (!e.includes("/") && e === baseKey(id))
}

function listRawSources(vault) {
  return walk(sourcesRoot(vault), { dir: (n) => !n.startsWith(".cache"), file: (n) => !n.endsWith(".parser") })
}

function identityOf(vault, file) {
  return toPosix(path.relative(sourcesRoot(vault), file))
}

function resolveSource(vault, arg) {
  const candidates = [path.resolve(arg), path.resolve(vault, arg), path.join(sourcesRoot(vault), arg)]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile() && isInside(c, sourcesRoot(vault))) return { identity: identityOf(vault, c), file: c }
  }
  const matches = listRawSources(vault).filter((f) => citesSource(arg, identityOf(vault, f)) || sourceKey(identityOf(vault, f)) === sourceKey(arg))
  if (matches.length === 1) return { identity: identityOf(vault, matches[0]), file: matches[0] }
  if (matches.length > 1) die(`"${arg}" matches several sources:\n  ${matches.map((m) => identityOf(vault, m)).join("\n  ")}\nPass the path under raw/sources.`)
  return { identity: toPosix(arg).replace(/^raw\/sources\//, ""), file: null } // already deleted externally
}

function isInside(file, dir) {
  const rel = path.relative(dir, file)
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
}

export function cachePath(file) {
  return path.join(path.dirname(file), ".cache", `${path.basename(file)}.txt`)
}

function md5(file) {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex")
}

function uniqueDest(dir, name) {
  const ext = path.extname(name), stem = path.basename(name, ext)
  let dest = path.join(dir, name)
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${stem}-${n}${ext}`)
  return dest
}

function extractText(file) {
  const cache = cachePath(file)
  if (fs.existsSync(cache) && fs.statSync(cache).mtimeMs >= fs.statSync(file).mtimeMs && fs.statSync(cache).size > 0) return { cache, how: "cached" }
  const ext = path.extname(file).toLowerCase()
  fs.mkdirSync(path.dirname(cache), { recursive: true })
  if (TEXT_EXT.has(ext)) { fs.copyFileSync(file, cache); return { cache, how: "copied" } }
  if (ext === ".pdf") {
    // Run on ASCII temp paths: some Windows pdftotext builds (xpdf in Git for Windows) can't open
    // names with characters such as ’.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
    try {
      fs.copyFileSync(file, path.join(tmp, "in.pdf"))
      execFileSync("pdftotext", ["-enc", "UTF-8", path.join(tmp, "in.pdf"), path.join(tmp, "out.txt")], { stdio: ["ignore", "ignore", "pipe"] })
      if (fs.statSync(path.join(tmp, "out.txt")).size > 0) { fs.copyFileSync(path.join(tmp, "out.txt"), cache); return { cache, how: "pdftotext" } }
      return { cache, how: "needs-text", reason: "pdftotext produced no text (scanned PDF?)" }
    } catch (err) {
      return { cache, how: "needs-text", reason: err.code === "ENOENT" ? "pdftotext not installed" : `pdftotext failed: ${String(err.stderr || err.message).trim().slice(0, 200)}` }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
  return { cache, how: "needs-text", reason: `no built-in extractor for ${ext || "this file"}` }
}

// Split cached text into sections no longer than maxChars, cutting at a heading-like line or a
// blank line in the last 30% of each window (PR #846: long sources are generated per section).
export function planSections(text, maxChars = 60000) {
  const lines = text.split(/\r?\n/)
  const sections = []
  let start = 0
  while (start < lines.length) {
    let chars = 0, i = start
    while (i < lines.length && chars + lines[i].length + 1 <= maxChars) chars += lines[i++].length + 1
    if (i === start) i = start + 1 // one huge line
    if (i < lines.length) {
      let cut = -1, blank = -1, acc = 0
      for (let j = i - 1; j > start; j--) {
        acc += lines[j].length + 1
        if (acc > maxChars * 0.3) break
        if (cut < 0 && /^(#{1,3} \S|(chapter|part|section|appendix)\b|\d{1,2}(\.\d+)?\s+[A-Z])/i.test(lines[j].trim())) cut = j
        if (blank < 0 && lines[j].trim() === "") blank = j
      }
      i = cut > start ? cut : blank > start ? blank : i
    }
    const firstText = lines.slice(start, i).find((l) => l.trim()) || ""
    sections.push({ n: sections.length + 1, startLine: start + 1, endLine: i, heading: firstText.trim().slice(0, 80) })
    start = i
  }
  return sections
}

// ───────────────────────── manifest ─────────────────────────

function readManifest(vault) {
  try { return JSON.parse(fs.readFileSync(path.join(vault, MANIFEST), "utf8")) } catch { return {} }
}

function writeManifest(vault, m) {
  fs.mkdirSync(path.join(vault, ".llm-wiki"), { recursive: true })
  fs.writeFileSync(path.join(vault, MANIFEST), JSON.stringify(m, null, 2) + "\n")
}

// ───────────────────────── slugs & summary path ─────────────────────────

export function slugify(name, maxBytes = 100) {
  let s = name.normalize("NFKC").toLowerCase().replace(/[‘’']/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "")
  while (Buffer.byteLength(s) > maxBytes) s = Array.from(s).slice(0, -1).join("")
  return s.replace(/-+$/, "") || "source"
}

const STOPWORDS = new Set(["a", "an", "the", "of", "and", "for", "from", "in", "on", "to", "with", "by", "at", "or", "via", "vs"])

// A short kebab-case file name for an imported source: the work's title without authors, publisher,
// year, hashes or subtitle, at most `maxWords` words. Handles common download names such as
// "Title -- Authors -- Year -- hash", "Author - Title (2015, Pub) - site.org" and "Title{Author}(2021, Pub){id}".
export function shortSourceName(fileName, maxWords = 6) {
  const ext = path.extname(fileName).toLowerCase()
  let s = path.basename(fileName, path.extname(fileName)).normalize("NFKC").split(" -- ")[0]
  s = s.replace(/\{[^}]*\}|\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s*-?\s*\b[\w-]+\.[a-z]{2,4}(?:-\d+)?$/i, "") // trailing "- site.org"
  s = s.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0] || s // "Author - Title": the title is the longer part
  s = s.split(/_\s|:\s/)[0] // "Title_ Subtitle" (":" is often saved as "_")
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ") // ShadowBankingTheMoneyView
  const words = slugify(s, 1000).split("-").filter(Boolean).slice(0, maxWords)
  while (words.length > 1 && STOPWORDS.has(words.at(-1))) words.pop()
  return `${words.join("-") || "source"}${ext}`
}

// Port of llm_wiki's sourceSummarySlugFromIdentity: the app names a source page from the raw file's
// path alone, so the skill must use the same name or an app re-ingest writes a second summary page.
const fnv36 = (v) => {
  let h = 0x811c9dc5
  for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

export function appSummarySlug(identity) {
  const parts = identity.replace(/\.[^/.]+$/, "").split("/").map((p) => p.trim()).filter(Boolean)
  const hash = fnv36(identity)
  let slug = parts[0] || "source"
  if (parts.length > 1) {
    const joined = parts.map((part) => {
      const st = part.normalize("NFKC").trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]/gu, "").replace(/^-|-$/g, "").toLowerCase()
      return `${Math.max(1, Array.from(st || "source").length)}-${st.replace(/-+/g, "-") || "source"}`
    }).join("--")
    slug = `${joined}--${hash}`.length <= 120 ? `${joined}--${hash}` : `${joined.slice(0, 120 - hash.length - 2).replace(/-+$/, "") || "source"}--${hash}`
  }
  if (Buffer.byteLength(slug) <= 252 && !/[\uD800-\uDFFF]/u.test(slug)) return slug
  const suffix = `--${hash}`
  const readable = (slug.endsWith(suffix) ? slug.slice(0, -suffix.length) : slug).replace(/[\uD800-\uDFFF]/gu, "")
  let prefix = ""
  for (const ch of readable) { if (Buffer.byteLength(prefix + ch) > 252 - suffix.length) break; prefix += ch }
  return `${prefix.replace(/-+$/, "") || "source"}${suffix}`
}

function summaryPathFor(vault, identity, pages) {
  const existing = pages.find((p) => p.type === "source" && p.rel.startsWith("wiki/sources/") && p.sources.some((s) => citesSource(s, identity)))
  return existing ? existing.rel : `wiki/sources/${appSummarySlug(identity)}.md`
}

// Point every [[link]] and frontmatter link field (related, source, evidence, …) at oldKey to newStem.
export function retarget(text, oldKey, newStem) {
  const { raw, body } = splitFrontmatter(text)
  let out = raw + body.replace(WIKILINK, (m, embed, target, label) => {
    if (embed || linkKey(target) !== oldKey) return m
    const [pathPart, ...anchor] = target.split("#")
    const dir = pathPart.includes("/") ? pathPart.slice(0, pathPart.lastIndexOf("/") + 1) : ""
    const esc = pathPart.trimEnd().endsWith("\\") ? "\\" : "" // `[[a\|b]]` inside tables
    return `[[${dir}${newStem}${anchor.length ? `#${anchor.join("#")}` : ""}${esc}${label ? `|${label}` : ""}]]`
  })
  const fm = splitFrontmatter(out).fm
  for (const key of new Set([...(fm ?? "").matchAll(/^([A-Za-z_][\w-]*)[ \t]*:/gm)].map((m) => m[1]))) {
    if (["sources", "title", "aliases", "type"].includes(key)) continue
    const v = getField(fm, key)
    if (Array.isArray(v) && v.some((x) => linkKey(x) === oldKey)) out = setField(out, key, formatArray([...new Set(v.map((x) => (linkKey(x) === oldKey ? newStem : x)))]))
    else if (typeof v === "string" && linkKey(v) === oldKey) out = setField(out, key, yamlScalar(newStem))
  }
  return out
}

// Rename a raw source: moves the file and its text cache, renames its summary page to the app's name for
// the new file, and repoints sources entries, links and link fields across the wiki.
export function renameSource(vault, identity, newName) {
  const root = sourcesRoot(vault)
  const from = path.join(root, identity)
  if (!fs.existsSync(from)) die(`source not found: raw/sources/${identity}`)
  // top level of raw/sources: llm_wiki prefixes a folder path and a hash to the page name of any nested file
  const newId = `${slugify(newName.replace(/\.[^.\s]+$/, ""))}${path.extname(identity).toLowerCase()}`
  const to = path.join(root, newId)
  if (sourceKey(newId) === sourceKey(identity)) die("new name equals the current name")
  if (fs.existsSync(to)) die(`raw/sources/${newId} already exists`)
  const pages = loadPages(vault)
  const summary = pages.find((p) => p.type === "source" && p.rel.startsWith("wiki/sources/") && p.sources.some((s) => citesSource(s, identity)))
  const newSlug = appSummarySlug(newId)
  const clash = pages.find((p) => p.key === newSlug.toLowerCase() && p !== summary)
  if (clash) die(`a page named ${newSlug} already exists: ${clash.rel}`)

  moveTo(from, to)
  for (const suffix of ["", ".parser"]) if (fs.existsSync(cachePath(from) + suffix)) moveTo(cachePath(from) + suffix, cachePath(to) + suffix)
  let summaryRel = null
  if (summary) {
    summaryRel = `wiki/sources/${newSlug}.md`
    moveTo(summary.file, path.join(vault, summaryRel))
    const media = path.join(vault, "wiki", "media", summary.stem)
    if (fs.existsSync(media)) moveTo(media, path.join(vault, "wiki", "media", newSlug))
    summary.file = path.join(vault, summaryRel)
  }
  let updated = 0
  for (const p of pages) {
    let text = p.text
    if (p.sources.some((s) => citesSource(s, identity))) text = setField(text, "sources", formatSources([...new Set(p.sources.map((s) => (citesSource(s, identity) ? newId : s)))]))
    if (summary) {
      text = retarget(text, summary.key, newSlug)
      // image paths into the moved wiki/media/<slug>/ folder, raw or URL-encoded as llm_wiki writes them
      for (const stem of new Set([summary.stem, encodeURIComponent(summary.stem)])) text = text.split(`media/${stem}/`).join(`media/${newSlug}/`)
    }
    if (text !== p.text) { fs.writeFileSync(p.file, text); updated++ }
  }
  const manifest = readManifest(vault)
  const rec = manifest[identity] ?? Object.entries(manifest).find(([k]) => sourceKey(k) === sourceKey(identity))?.[1] ?? {}
  for (const k of Object.keys(manifest)) if (sourceKey(k) === sourceKey(identity)) delete manifest[k]
  manifest[newId] = { ...rec, ...(summaryRel ? { summary: summaryRel } : {}) }
  writeManifest(vault, manifest)
  return { from: identity, to: newId, summaryPage: summaryRel, summaryLink: summaryRel && `[[${newSlug}]]`, pagesUpdated: updated }
}

// ───────────────────────── mention ranking (PR #839) ─────────────────────────

const norm = (s) => ` ${s.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `
const hasCjk = (s) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s)

function countOcc(hay, needle) {
  let n = 0
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++
  return n
}

// Rank pages whose title, slug or alias appears in `text` as a whole word. Names under 4
// characters count only as exact-case all-caps acronyms (so "IMF" matches, "sec" does not).
export function rankMentions(text, pages, limit = 300) {
  const exact = norm(text)
  const lower = exact.toLowerCase()
  const ranked = []
  for (const p of pages) {
    const names = new Set([p.title, p.stem.replace(/-/g, " "), ...p.aliases].map((n) => String(n).trim()).filter(Boolean))
    let count = 0
    for (const name of names) {
      const cleaned = norm(name).trim()
      if (!cleaned) continue
      if (hasCjk(cleaned)) { if (cleaned.length >= 2) count += countOcc(exact.replace(/ /g, ""), cleaned.replace(/ /g, "")); continue }
      if (cleaned.length < 4) { if (/^[A-Z0-9]+$/.test(cleaned) && /[A-Z]/.test(cleaned)) count += countOcc(exact, ` ${cleaned} `); continue }
      count += countOcc(lower, ` ${cleaned.toLowerCase()} `)
    }
    if (count > 0) ranked.push({ page: p, count })
  }
  ranked.sort((a, b) => b.count - a.count || a.page.rel.localeCompare(b.page.rel))
  return ranked.slice(0, limit)
}

// ───────────────────────── log (PR #843) ─────────────────────────

// Drop a frontmatter block only when it starts the entry and looks like YAML fields; an entry
// wrapped in `---` horizontal rules is left alone.
export function stripLogEntryFrontmatter(entry) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(entry)
  if (!m) return entry
  const lines = m[1].split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length || !lines.every((l) => /^[A-Za-z_][\w-]*[ \t]*:|^[ \t]+|^-[ \t]/.test(l))) return entry
  return entry.slice(m[0].length).replace(/^\s+/, "")
}

export function prependLog(logText, entry) {
  const header = /^# .*\r?\n/.exec(logText)
  const head = header ? header[0] : "# Wiki Log\n"
  const rest = header ? logText.slice(header[0].length) : logText
  return `${head}\n${entry.trim()}\n\n${rest.replace(/^\s+/, "")}`.trimEnd() + "\n"
}

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// ───────────────────────── sync: Related sections, source pages, index ─────────────────────────

export function relatedBlock(page, keys) {
  const linked = new Set(wikilinks(stripBlock(stripBlock(page.body, RELATED), SOURCE_PAGES)))
  const seen = new Set()
  const lines = []
  for (const k of page.related) {
    if (k === page.key || linked.has(k) || seen.has(k) || !keys.has(k)) continue
    seen.add(k)
    const target = keys.get(k)[0]
    lines.push(`- [[${target.stem}${target.title && target.title !== target.stem ? `|${target.title.replace(/[[\]|]/g, "")}` : ""}]]`)
  }
  if (!lines.length) return ""
  // page already ends with its own "## Related" section: continue that list instead of a second heading
  const lastHeading = [...page.body.matchAll(/^## (.+)$/gm)].at(-1)?.[1].trim()
  return lastHeading === "Related" ? lines.join("\n") : `## Related\n\n${lines.join("\n")}`
}

export function sourcePagesBlock(summary, pages, identity) {
  const linked = new Set(wikilinks(stripBlock(stripBlock(summary.body, RELATED), SOURCE_PAGES)))
  const groups = new Map()
  for (const p of pages) {
    if (p.file === summary.file || AGGREGATES.has(p.key) || linked.has(p.key)) continue
    if (!p.sources.some((s) => citesSource(s, identity))) continue
    const folder = p.rel.split("/").slice(1, -1).join("/") || "wiki"
    if (!groups.has(folder)) groups.set(folder, [])
    groups.get(folder).push(p)
  }
  if (!groups.size) return ""
  const parts = ["## Pages From This Source"]
  for (const [folder, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a.title.localeCompare(b.title))
    parts.push("", `### ${folder}`, "", ...list.map((p) => `- [[${p.stem}${p.title !== p.stem ? `|${p.title.replace(/[[\]|]/g, "")}` : ""}]]`))
  }
  return parts.join("\n")
}

// wiki/index.md belongs to llm_wiki. Like its updateWikiIndexDeterministically, only add pages the
// index doesn't link yet to a bounded "## Recently Updated" section (newest first, max 200).
export function addToRecentIndex(index, pages) {
  const known = new Set([...index.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].replace(/^wiki\//i, "").replace(/\.md$/i, "").toLowerCase()))
  const additions = []
  for (const p of pages) {
    const target = p.rel.replace(/^wiki\//, "").replace(/\.md$/i, "")
    if (known.has(target.toLowerCase()) || AGGREGATES.has(target.toLowerCase())) continue
    known.add(target.toLowerCase())
    additions.push(`- [[${target}]] — ${p.title}`)
  }
  if (!additions.length) return index
  const section = "## Recently Updated"
  const lines = (index.trim() ? index : "# Wiki Index\n").trimEnd().split("\n")
  const start = lines.findIndex((l) => l.trim() === section)
  const end = start >= 0 ? lines.findIndex((l, i) => i > start && /^##\s+/.test(l)) : -1
  const prefix = start >= 0 ? lines.slice(0, start) : lines
  while (prefix.length && !prefix.at(-1).trim()) prefix.pop() // one blank line before the section, not one more per call
  const existing = start >= 0 ? lines.slice(start + 1, end >= 0 ? end : undefined).filter((l) => /^-\s+/.test(l)) : []
  const suffix = end >= 0 ? lines.slice(end) : []
  const recent = [...new Set([...additions, ...existing])].slice(0, 200)
  return [...prefix, "", section, ...recent, ...(suffix.length ? ["", ...suffix] : []), ""].join("\n")
}

// Only touches script-owned blocks at the end of pages; frontmatter, index.md and page text stay as they are.
export function sync(vault, { write = true } = {}) {
  const pages = loadPages(vault)
  const keys = byKey(pages)
  const manifest = readManifest(vault)
  const summaries = new Map()
  for (const [identity, rec] of Object.entries(manifest)) if (rec.summary) summaries.set(rec.summary, identity)
  let changed = 0
  for (const p of pages) {
    if (AGGREGATES.has(p.key) && p.rel.split("/").length === 2) continue
    const base = stripGenerated(p.body)
    let body = base
    const identity = p.type === "source" ? summaries.get(p.rel) ?? (p.sources.length === 1 ? p.sources[0] : null) : null
    if (identity) body = putBlock(body, SOURCE_PAGES, sourcePagesBlock({ ...p, body: base }, pages, identity))
    body = putBlock(body, RELATED, relatedBlock({ ...p, body: base }, keys)) // Related stays last
    if (body.trimEnd() !== p.body.trimEnd()) {
      p.body = body
      p.text = (p.fm == null ? "" : splitFrontmatter(p.text).raw) + body
      if (write) fs.writeFileSync(p.file, p.text)
      changed++
    }
  }
  return { pages: pages.length, changed }
}

// ───────────────────────── lint ─────────────────────────

export function lint(vault, { target = "" } = {}) {
  const pages = loadPages(vault)
  const keys = byKey(pages)
  const inbound = new Map()
  const issues = { frontmatter: [], brokenLinks: [], duplicateNames: [], orphans: [], unresolvedRelated: [], wrongLanguage: [] }
  for (const p of pages) {
    if (!["wiki/index.md", "wiki/log.md", "wiki/overview.md"].includes(p.rel)) for (const prob of frontmatterProblems(p.text)) issues.frontmatter.push(`${p.rel}: ${prob}`)
    const links = new Set(wikilinks(p.body))
    const aggregate = AGGREGATES.has(p.key) // index/log/overview link everything; they don't count as inbound
    for (const k of links) {
      if (keys.has(k)) { if (!aggregate && k !== p.key) inbound.set(k, (inbound.get(k) || 0) + 1) }
      else issues.brokenLinks.push(`${p.rel} → [[${k}]]`)
    }
    for (const k of p.related) if (!keys.has(k)) issues.unresolvedRelated.push(`${p.rel}: related "${k}"`)
    // PR #842: an English page with a few Chinese glosses is fine; flag only when CJK is >=20% of letters.
    if (target && !/^(zh|ja|ko|chinese|japanese|korean)/i.test(target)) {
      const letters = p.body.match(/\p{L}/gu) || []
      const cjk = letters.filter((c) => hasCjk(c)).length
      if (letters.length > 200 && cjk / letters.length >= 0.2) issues.wrongLanguage.push(`${p.rel}: ${Math.round((100 * cjk) / letters.length)}% CJK letters`)
    }
  }
  for (const [k, list] of keys) if (list.length > 1) issues.duplicateNames.push(`[[${k}]] is ambiguous: ${list.map((p) => p.rel).join(", ")}`)
  for (const p of pages) if (!AGGREGATES.has(p.key) && !inbound.get(p.key)) issues.orphans.push(p.rel)
  return { pages: pages.length, issues }
}

// ───────────────────────── remove (cascade, mirrors llm_wiki deleteSourceFiles) ─────────────────────────

export function planRemoval(vault, identities) {
  const pages = loadPages(vault)
  const remove = [], rewrite = []
  for (const p of pages) {
    if (!p.sources.length) continue // pages with no sources (queries, hand-written notes) are never deleted
    const survivors = p.sources.filter((s) => !identities.some((id) => citesSource(s, id)))
    if (survivors.length === p.sources.length) continue
    if (survivors.length === 0) remove.push(p)
    else rewrite.push({ page: p, survivors })
  }
  return { pages, remove, rewrite }
}

export function applyRemoval(vault, identities, plan, { trash }) {
  const { pages, remove, rewrite } = plan
  fs.mkdirSync(trash, { recursive: true })
  const deleted = new Map(remove.map((p) => [p.key, p.title]))
  // raw files + text caches move to trash (recoverable), like the pages
  for (const id of identities) {
    const file = path.join(sourcesRoot(vault), id)
    for (const f of [file, cachePath(file), `${cachePath(file)}.parser`, path.join(sourcesRoot(vault), ".cache", `${path.basename(id)}.txt`)]) {
      if (fs.existsSync(f)) moveTo(f, path.join(trash, path.relative(vault, f)))
    }
  }
  for (const p of remove) {
    moveTo(p.file, path.join(trash, p.rel))
    const media = path.join(vault, "wiki", "media", p.stem)
    if (p.rel.startsWith("wiki/sources/") && fs.existsSync(media)) moveTo(media, path.join(trash, "wiki", "media", p.stem))
  }
  const removedFiles = new Set(remove.map((p) => p.file))
  const rewriteMap = new Map(rewrite.map((r) => [r.page.file, r.survivors]))
  const stillThere = byKey(pages.filter((p) => !removedFiles.has(p.file)))
  const gone = new Set([...deleted.keys()].filter((k) => !stillThere.has(k)))
  let rewritten = 0
  for (const p of pages) {
    if (removedFiles.has(p.file)) continue
    let text = p.text
    if (rewriteMap.has(p.file)) text = setField(text, "sources", formatSources(rewriteMap.get(p.file)))
    if (gone.size && p.rel === "wiki/index.md") {
      // like llm_wiki's cleanIndexListing: drop list entries for deleted pages
      text = text.split("\n").filter((l) => !(/^\s*[-*]\s/.test(l) && wikilinks(l).some((k) => gone.has(k)))).join("\n")
    }
    if (gone.size) {
      const { raw, body } = splitFrontmatter(text)
      const nextBody = body.replace(WIKILINK, (m, embed, target, label) => (embed || !gone.has(linkKey(target)) ? m : label || deleted.get(linkKey(target)) || target))
      text = raw + nextBody
      const rel = getArray(splitFrontmatter(text).fm, "related")
      const kept = rel.filter((s) => !gone.has(linkKey(s)))
      if (kept.length !== rel.length) text = setField(text, "related", formatArray(kept))
    }
    if (text !== p.text) { fs.writeFileSync(p.file, text); rewritten++ }
  }
  const manifest = readManifest(vault)
  for (const id of Object.keys(manifest)) if (identities.some((x) => sourceKey(x) === sourceKey(id))) delete manifest[id]
  writeManifest(vault, manifest)
  return { deleted: remove.length, rewritten }
}

function moveTo(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try { fs.renameSync(from, to) } catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }) }
}

// ───────────────────────── init ─────────────────────────

const GRAPH_COLORS = [0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc948, 0xb07aa1, 0xff9da7, 0x9c755f, 0xbab0ac, 0x86bcb6, 0xd37295, 0x8cd17d]

export function schemaDirs(schema) {
  const dirs = []
  for (const m of schema.matchAll(/^\|\s*[\w-]+\s*\|\s*`?(wiki\/[\w\-/]*)`?\s*\|/gm)) {
    const dir = m[1].replace(/\/+$/, "")
    if (dir !== "wiki") dirs.push(dir) // `wiki/` is the overview row, not a folder
  }
  return [...new Set(dirs)]
}

function mergeJson(file, patch, arrayUnion = []) {
  let cur = {}
  try { cur = JSON.parse(fs.readFileSync(file, "utf8")) } catch { /* new file */ }
  const next = { ...patch, ...cur }
  for (const k of arrayUnion) next[k] = [...new Set([...(cur[k] || []), ...(patch[k] || [])])]
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n")
}

export function init(vault, name) {
  fs.mkdirSync(vault, { recursive: true })
  const created = []
  const copyTemplate = (file) => {
    const dest = path.join(vault, file)
    if (fs.existsSync(dest)) return
    fs.writeFileSync(dest, fs.readFileSync(path.join(TEMPLATES, file), "utf8").replaceAll("{{NAME}}", name))
    created.push(file)
  }
  copyTemplate("purpose.md")
  copyTemplate("schema.md")
  const schema = fs.readFileSync(path.join(vault, "schema.md"), "utf8")
  const dirs = schemaDirs(schema)
  for (const d of ["raw/sources", "raw/assets", "wiki/sources", ...dirs]) fs.mkdirSync(path.join(vault, d), { recursive: true })
  const wikiFile = (rel, content) => {
    const f = path.join(vault, rel)
    if (!fs.existsSync(f)) { fs.writeFileSync(f, content); created.push(rel) }
  }
  wikiFile("wiki/index.md", "# Wiki Index\n")
  wikiFile("wiki/log.md", "# Wiki Log\n")
  wikiFile("wiki/overview.md", `---\ntype: overview\ntitle: ${yamlScalar(`${name} — Overview`)}\ntags: []\nrelated: []\nsources: []\ncreated: ${today()}\nupdated: ${today()}\n---\n\n# Overview\n\nNo sources ingested yet.\n`)
  const project = path.join(vault, ".llm-wiki", "project.json")
  if (!fs.existsSync(project)) {
    fs.mkdirSync(path.dirname(project), { recursive: true })
    fs.writeFileSync(project, JSON.stringify({ id: crypto.randomUUID(), createdAt: Date.now() }, null, 2))
    created.push(".llm-wiki/project.json")
  }
  // Obsidian: attachments into raw/assets, hide caches, graph colored by page folder.
  mergeJson(path.join(vault, ".obsidian", "app.json"), { attachmentFolderPath: "raw/assets", useMarkdownLinks: false, newLinkFormat: "shortest", userIgnoreFilters: [".cache", ".llm-wiki"] }, ["userIgnoreFilters"])
  mergeJson(path.join(vault, ".obsidian", "core-plugins.json"), {})
  const plugins = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian", "core-plugins.json"), "utf8"))
  if (Array.isArray(plugins)) { if (!plugins.includes("graph")) fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify([...plugins, "graph"], null, 2)) }
  else if (!plugins.graph) fs.writeFileSync(path.join(vault, ".obsidian", "core-plugins.json"), JSON.stringify({ ...plugins, graph: true }, null, 2))
  const graph = path.join(vault, ".obsidian", "graph.json")
  const graphDirs = [...new Set(["wiki/sources", ...dirs, ...fs.readdirSync(path.join(vault, "wiki"), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "media").map((e) => `wiki/${e.name}`)])]
  const colorGroups = graphDirs.map((d, i) => ({ query: `path:"${d}/"`, color: { a: 1, rgb: GRAPH_COLORS[i % GRAPH_COLORS.length] } }))
  const ours = { search: 'path:wiki/ -path:"wiki/index.md" -path:"wiki/log.md"', showTags: false, showAttachments: false, hideUnresolved: true, showOrphans: true, colorGroups, showArrow: false }
  let current = null
  try { current = JSON.parse(fs.readFileSync(graph, "utf8")) } catch { /* missing or unreadable */ }
  let graphNote = "kept existing .obsidian/graph.json (it has your own filter or colour groups)"
  // Obsidian writes graph.json with defaults the first time the graph opens; fill in ours only while
  // the user hasn't customized the filter or colours, and keep their layout settings.
  if (!current || (!current.search && !(current.colorGroups || []).length)) {
    fs.writeFileSync(graph, JSON.stringify({ ...(current || {}), ...ours }, null, 2))
    graphNote = "wrote graph settings to .obsidian/graph.json (if Obsidian was open, close and reopen the vault, or it may overwrite them)"
  }
  return { created, dirs: graphDirs, graphNote }
}

// ───────────────────────── CLI ─────────────────────────

function die(msg) { console.error(msg); process.exit(1) }

function flag(args, name, fallback) {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}

function sourceStatus(vault, identity, file, sectionChars) {
  const pages = loadPages(vault)
  const manifest = readManifest(vault)
  const rec = manifest[identity] || {}
  const out = { identity, file: file && toPosix(path.relative(vault, file)) }
  if (file) {
    const { cache, how, reason } = extractText(file)
    if (reason) out.extractionProblem = reason
    const hash = md5(file)
    out.text = toPosix(path.relative(vault, cache))
    out.extraction = how
    // PR #838: replace single-source pages only when a previous ingest is on record with a different hash.
    out.sourceChanged = Boolean(rec.ingestedHash && rec.ingestedHash !== hash)
    if (how !== "needs-text") {
      const text = fs.readFileSync(cache, "utf8")
      out.chars = text.length
      out.sections = planSections(text, sectionChars)
      rec.sections = out.sections.length
      rec.sectionChars = sectionChars
    }
    rec.md5 = hash
  }
  const summary = summaryPathFor(vault, identity, pages)
  rec.summary = summary
  out.summaryPage = summary
  // PR #844: the exact link to use for the source page everywhere, including `source:` fields.
  out.summaryLink = `[[${path.basename(summary, ".md")}]]`
  out.sourcesEntry = identity
  out.sectionsDone = rec.done || []
  out.pagesFromThisSource = pages.filter((p) => p.sources.some((s) => citesSource(s, identity))).map((p) => `${p.rel} — ${p.title}`)
  manifest[identity] = rec
  writeManifest(vault, manifest)
  return out
}

function main(argv) {
  const [cmd, ...args] = argv
  const vault = args[0] && path.resolve(args[0])
  const need = () => { if (!vault) die(`usage: wiki.mjs ${cmd} <vault> ...`) }
  switch (cmd) {
    case "init": {
      need()
      const name = flag(args, "--name", path.basename(vault))
      console.log(JSON.stringify(init(vault, name), null, 2))
      break
    }
    case "add": {
      need()
      const sectionChars = Number(flag(args, "--section-chars", 60000))
      const name = flag(args, "--name", "")
      const files = args.slice(1)
      if (!files.length) die("usage: wiki.mjs add <vault> <file-or-folder>... [--name short-name]")
      if (name && (files.length > 1 || fs.statSync(path.resolve(files[0])).isDirectory())) die("--name works with a single file")
      const root = sourcesRoot(vault)
      fs.mkdirSync(root, { recursive: true })
      const existing = listRawSources(vault)
      const expanded = files.flatMap((f) => (fs.statSync(path.resolve(f)).isDirectory() ? walk(path.resolve(f), { dir: (n) => !n.startsWith("."), file: (n) => !n.startsWith(".") }) : [path.resolve(f)]))
      const results = []
      for (const src of expanded) {
        let target = src
        if (!isInside(src, root)) {
          // PR #846: don't import a file whose content is already in raw/sources (renamed copy, "name (1)").
          const size = fs.statSync(src).size
          const hash = md5(src)
          const dupe = existing.find((f) => fs.statSync(f).size === size && md5(f) === hash)
          if (dupe) target = dupe
          else {
            // a short file name, because llm_wiki names the source page (a graph node) after it
            const short = name ? `${slugify(name.replace(/\.[^.\s]+$/, ""))}${path.extname(src).toLowerCase()}` : shortSourceName(path.basename(src))
            target = uniqueDest(root, short)
            fs.copyFileSync(src, target)
            existing.push(target)
          }
          if (dupe) results.push({ note: `already in sources as ${identityOf(vault, dupe)}; not copied` })
        }
        results.push(sourceStatus(vault, identityOf(vault, target), target, sectionChars))
      }
      console.log(JSON.stringify(results, null, 2))
      break
    }
    case "rename-source": {
      need()
      const [, src, newName] = args
      if (!src || !newName) die("usage: wiki.mjs rename-source <vault> <source> <new-short-name>")
      const r = renameSource(vault, resolveSource(vault, src).identity, newName)
      console.log(JSON.stringify({ ...r, synced: sync(vault) }, null, 2))
      break
    }
    case "status": {
      need()
      const sectionChars = Number(flag(args, "--section-chars", 60000))
      const { identity, file } = resolveSource(vault, args[1] ?? die("usage: wiki.mjs status <vault> <source>"))
      console.log(JSON.stringify(sourceStatus(vault, identity, file, sectionChars), null, 2))
      break
    }
    case "mentions": {
      need()
      const limit = Number(flag(args, "--limit", 300))
      const section = Number(flag(args, "--section", 0))
      const sc = Number(flag(args, "--section-chars", 0))
      const { identity, file } = resolveSource(vault, args[1] ?? die("usage: wiki.mjs mentions <vault> <source> [--section N]"))
      if (!file) die(`source not found: ${args[1]}`)
      const sectionChars = sc || readManifest(vault)[identity]?.sectionChars || 60000
      let text = fs.readFileSync(cachePath(file), "utf8")
      if (section) {
        const s = planSections(text, sectionChars)[section - 1] ?? die(`no section ${section}`)
        text = text.split(/\r?\n/).slice(s.startLine - 1, s.endLine).join("\n")
      }
      const others = loadPages(vault).filter((p) => !AGGREGATES.has(p.key) && !p.sources.some((s) => citesSource(s, identity)))
      for (const { page, count } of rankMentions(text, others, limit)) console.log(`${count}\t${page.rel}\t${page.title}`)
      break
    }
    case "done": {
      need()
      const { identity } = resolveSource(vault, args[1] ?? die("usage: wiki.mjs done <vault> <source> <section>"))
      const manifest = readManifest(vault)
      const n = Number(args[2])
      if (!Number.isInteger(n) || n < 1) die("usage: wiki.mjs done <vault> <source> <section>")
      const rec = (manifest[identity] ||= {})
      rec.done = [...new Set([...(rec.done || []), n])].sort((a, b) => a - b)
      writeManifest(vault, manifest)
      console.log(`section ${n} recorded; ${rec.done.length} of ${rec.sections ?? "?"} sections done (${rec.done.join(", ")})`)
      break
    }
    case "finalize": {
      need()
      const { identity, file } = resolveSource(vault, args[1] ?? die("usage: wiki.mjs finalize <vault> <source>"))
      const manifest = readManifest(vault)
      const rec = (manifest[identity] ||= {})
      if (file) rec.ingestedHash = md5(file)
      rec.ingested = today()
      rec.done = []
      writeManifest(vault, manifest)
      const s = sync(vault)
      const indexFile = path.join(vault, "wiki", "index.md")
      const index = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, "utf8") : ""
      const nextIndex = addToRecentIndex(index, loadPages(vault).filter((p) => p.sources.some((x) => citesSource(x, identity))))
      if (nextIndex !== index) fs.writeFileSync(indexFile, nextIndex)
      const l = lint(vault)
      const mine = (x) => l.issues[x].length
      console.log(JSON.stringify({ synced: s, indexUpdated: nextIndex !== index, issueCounts: Object.fromEntries(Object.keys(l.issues).map((k) => [k, mine(k)])), duplicateNames: l.issues.duplicateNames.slice(0, 50), frontmatter: l.issues.frontmatter.slice(0, 50), brokenLinks: l.issues.brokenLinks.slice(0, 50) }, null, 2))
      break
    }
    case "sync": {
      need()
      const dry = args.includes("--dry-run")
      console.log(JSON.stringify(sync(vault, { write: !dry }), null, 2))
      break
    }
    case "lint": {
      need()
      const target = flag(args, "--language", "")
      const limit = Number(flag(args, "--limit", 100))
      const { pages, issues } = lint(vault, { target })
      console.log(`${pages} pages`)
      for (const [k, list] of Object.entries(issues)) {
        console.log(`\n## ${k} (${list.length})`)
        for (const line of list.slice(0, limit)) console.log(`- ${line}`)
        if (list.length > limit) console.log(`- … ${list.length - limit} more`)
      }
      break
    }
    case "remove": {
      need()
      const yes = args.includes("--yes")
      const ids = args.slice(1).filter((a) => a !== "--yes").map((a) => resolveSource(vault, a).identity)
      if (!ids.length) die("usage: wiki.mjs remove <vault> <source>... [--yes]")
      const plan = planRemoval(vault, ids)
      console.log(`Sources: ${ids.join(", ")}`)
      console.log(`Pages to delete (cite only these sources): ${plan.remove.length}`)
      for (const p of plan.remove.slice(0, 200)) console.log(`  - ${p.rel}`)
      if (plan.remove.length > 200) console.log(`  … ${plan.remove.length - 200} more`)
      console.log(`Pages kept, with these sources dropped from \`sources\`: ${plan.rewrite.length}`)
      for (const r of plan.rewrite.slice(0, 50)) console.log(`  - ${r.page.rel}`)
      if (!yes) { console.log("\nDry run. Re-run with --yes to apply."); break }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const trash = path.join(vault, ".llm-wiki", "trash", stamp)
      const r = applyRemoval(vault, ids, plan, { trash })
      const s = sync(vault)
      const logFile = path.join(vault, "wiki", "log.md")
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "# Wiki Log\n"
      fs.writeFileSync(logFile, prependLog(log, `## [${today()}] delete | ${ids.join(", ")}\n\n- Deleted ${r.deleted} pages that cited only this source; removed it from ${plan.rewrite.length} shared pages.\n- Backup: .llm-wiki/trash/${stamp}/`))
      console.log(JSON.stringify({ ...r, trash: toPosix(path.relative(vault, trash)), synced: s }, null, 2))
      break
    }
    case "log": {
      need()
      const [, action, ...title] = args
      if (!action || !title.length) die("usage: wiki.mjs log <vault> <action> <title...>  (bullets on stdin)")
      const body = stripLogEntryFrontmatter(fs.readFileSync(0, "utf8")).replace(/^## \[.*\n+/, "").trim()
      const logFile = path.join(vault, "wiki", "log.md")
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "# Wiki Log\n"
      fs.writeFileSync(logFile, prependLog(log, `## [${today()}] ${action} | ${title.join(" ")}\n\n${body}`))
      console.log("log updated")
      break
    }
    case "quote": {
      // prints a value rendered safely for frontmatter, e.g. a title with a colon
      console.log(yamlScalar(args.join(" ")))
      break
    }
    default:
      console.log(`usage: node wiki.mjs <command> <vault> ...
  init <vault> [--name N]              create or upgrade a vault (purpose, schema, dirs, Obsidian graph)
  add <vault> <file|folder>...         copy into raw/sources (skips duplicates), extract text, plan sections
  status <vault> <source>              same report for a source already in raw/sources
  mentions <vault> <source> [--section N]  existing pages from other sources named in the text
  done <vault> <source> <N>            record a finished section (resume support)
  finalize <vault> <source>            record ingest, sync Related/source-page sections + index, lint
  remove <vault> <source>... [--yes]   cascade-delete a source (dry run without --yes)
  rename-source <vault> <source> <name>  give a source (and its source page) a short name
  sync <vault> [--dry-run]             rebuild Related sections and index for the whole vault
  lint <vault> [--language English]    frontmatter, broken links, ambiguous names, orphans
  log <vault> <action> <title>         prepend a log entry; bullets on stdin
  quote <text>                         render a YAML-safe scalar`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
