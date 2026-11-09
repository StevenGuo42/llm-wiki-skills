// Run: node --test "<skill dir>/scripts/wiki.test.mjs"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFile, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  scanInlineArray, getArray, getField, splitFrontmatter, setField, yamlScalar, formatArray,
  frontmatterProblems, stripLogEntryFrontmatter, rankMentions, planSections, citesSource, slugify,
} from "./wiki.mjs"

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "wiki.mjs")
const W = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
const fmOf = (t) => splitFrontmatter(t).fm

test("inline arrays keep ] and commas inside quotes, and plain apostrophes (#834)", () => {
  assert.deepEqual(scanInlineArray('["Book [2nd ed] - scan.pdf", b]').items, ["Book [2nd ed] - scan.pdf", "b"])
  assert.deepEqual(scanInlineArray('["Money, Banking.pdf"]').items, ["Money, Banking.pdf"])
  assert.deepEqual(scanInlineArray("[koo's-view, foo]").items, ["koo's-view", "foo"])
  assert.deepEqual(scanInlineArray("['it''s', \"a\\\"b\"]").items, ["it's", 'a"b'])
  assert.deepEqual(scanInlineArray('["unterminated, x]').items, ['"unterminated', "x"])
  assert.deepEqual(scanInlineArray("[]").items, [])
})

test("block lists and scalars are read", () => {
  const fm = 'type: concept\ntitle: "A: B"\nsources:\n  - "x.pdf"\n  - y.md\nrelated: [a, b]'
  assert.deepEqual(getArray(fm, "sources"), ["x.pdf", "y.md"])
  assert.equal(getField(fm, "title"), "A: B")
  assert.deepEqual(getArray(fm, "related"), ["a", "b"])
})

test("setField splices, so $& in filenames stays literal (#834/#836)", () => {
  const page = '---\ntype: concept\nsources: ["a.pdf", "Profit $& Loss.pdf"]\ntags: []\n---\nbody $1\n'
  const out = setField(page, "sources", formatArray(["Profit $& Loss.pdf"]))
  assert.equal(out, '---\ntype: concept\nsources: ["Profit $& Loss.pdf"]\ntags: []\n---\nbody $1\n')
  assert.deepEqual(getArray(fmOf(out), "sources"), ["Profit $& Loss.pdf"])
})

test("scalars are quoted only when needed (#836)", () => {
  assert.equal(yamlScalar("Plain Title"), "Plain Title")
  assert.equal(yamlScalar("2026-11-08"), "2026-11-08")
  for (const t of ["Comomentum: Inferring Arbitrage", "Rule #1 # Not a comment", "Effect Is $121", "true", "42", "- dash"]) {
    const v = yamlScalar(t)
    assert.equal(getField(`title: ${v}`, "title"), t, v)
    assert.deepEqual(frontmatterProblems(`---\ntitle: ${v}\n---\n`), [])
  }
})

test("lint flags the frontmatter llm_wiki can't parse", () => {
  assert.match(frontmatterProblems("---\ntitle: Capital Budgeting: NPV\n---\n")[0], /unquoted/)
  assert.match(frontmatterProblems("---\nrelated: [[a]], [[b]]\n---\n")[0], /bare slugs/)
  assert.match(frontmatterProblems("```yaml\n---\n")[0], /no frontmatter/)
})

test("log entries lose a leading frontmatter block only (#843)", () => {
  assert.equal(stripLogEntryFrontmatter("---\ntype: log\ntitle: x\n---\n- did a thing"), "- did a thing")
  const ruled = "---\n- bullet inside rules\n\nmore prose here\n---\n"
  assert.equal(stripLogEntryFrontmatter("---\nJust prose, not yaml\n---\n- x"), "---\nJust prose, not yaml\n---\n- x")
  assert.equal(stripLogEntryFrontmatter("## [2026-01-01] ingest | X\n---\ntype: a\n---\n"), "## [2026-01-01] ingest | X\n---\ntype: a\n---\n")
  assert.ok(ruled)
})

test("mention ranking: whole words, short names only as acronyms (#839)", () => {
  const mk = (stem, title, aliases = []) => ({ stem, key: stem, title, aliases, rel: `wiki/concepts/${stem}.md` })
  const pages = [mk("imf", "IMF"), mk("sec", "sec"), mk("repo-market", "Repo Market"), mk("term-premium", "Term premium", ["期限溢价"]), mk("rep", "Rep")]
  const text = "The IMF said the repo market (repo-market) grew; reporting by the sec. 期限溢价上升. Term-Premium again."
  const got = Object.fromEntries(rankMentions(text, pages).map((r) => [r.page.stem, r.count]))
  assert.equal(got.imf, 1) // "IMF" title; the lowercase stem "imf" is too short to count
  assert.equal(got.sec, undefined)
  assert.equal(got.rep, undefined)
  assert.ok(got["repo-market"] >= 2)
  assert.ok(got["term-premium"] >= 2)
})

test("sections cover every line in order and respect the size cap (#846)", () => {
  const lines = []
  for (let c = 1; c <= 30; c++) { lines.push(`# Chapter ${c}`, ""); for (let i = 0; i < 40; i++) lines.push(`Line ${c}.${i} ` + "x".repeat(60)) }
  const text = lines.join("\n")
  const s = planSections(text, 20000)
  assert.ok(s.length >= 4)
  assert.equal(s[0].startLine, 1)
  assert.equal(s.at(-1).endLine, lines.length)
  for (let i = 1; i < s.length; i++) assert.equal(s[i].startLine, s[i - 1].endLine + 1)
  for (const x of s) assert.ok(lines.slice(x.startLine - 1, x.endLine).join("\n").length <= 20000)
  assert.ok(s.slice(1).every((x) => x.heading.startsWith("# Chapter")), "cuts land on headings")
  assert.equal(planSections("short", 20000).length, 1)
})

test("source matching and slugs", () => {
  assert.ok(citesSource(".temp/Jane’s Notes.pdf", ".temp/Jane's Notes.pdf"))
  assert.ok(citesSource("book.pdf", "papers/book.pdf"))
  assert.ok(!citesSource("other/book.pdf", "papers/book.pdf"))
  assert.equal(slugify("Book [2nd ed] - Smith's Guide"), "book-2nd-ed-smiths-guide")
  assert.equal(slugify("期限溢价 Notes"), "期限溢价-notes")
  assert.ok(Buffer.byteLength(slugify("长".repeat(200))) <= 100)
})

test("end to end: init, add, finalize, re-add duplicate, remove", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
  const vault = path.join(tmp, "My Vault, Test")
  W("init", vault, "--name", "Test")
  for (const f of ["purpose.md", "schema.md", "wiki/index.md", "wiki/log.md", ".obsidian/graph.json", ".llm-wiki/project.json"]) assert.ok(fs.existsSync(path.join(vault, f)), f)
  assert.ok(fs.existsSync(path.join(vault, "wiki/concepts")))
  const graph = JSON.parse(fs.readFileSync(path.join(vault, ".obsidian/graph.json"), "utf8"))
  assert.ok(graph.colorGroups.some((g) => g.query.includes("wiki/concepts/")))
  assert.ok(!graph.colorGroups.some((g) => g.query.includes("wiki//")), "overview row is not a folder")

  const inbox = path.join(tmp, "inbox")
  fs.mkdirSync(inbox)
  fs.writeFileSync(path.join(inbox, "Book A - Rates.md"), "# Ch 1\nTerm premium and the IMF.\n")
  fs.writeFileSync(path.join(inbox, "Paper B_ A Subtitle -- Doe, Jane -- 2019 -- 0123456789abcdef0123456789abcdef -- Some Archive.txt"), "Repo markets.\n")
  const [a] = JSON.parse(W("add", vault, path.join(inbox, "Book A - Rates.md"), "--name", "Book A Rates"))
  const [b] = JSON.parse(W("add", vault, path.join(inbox, "Paper B_ A Subtitle -- Doe, Jane -- 2019 -- 0123456789abcdef0123456789abcdef -- Some Archive.txt")))
  assert.equal(b.sourcesEntry, "paper-b.txt")
  assert.equal(b.summaryLink, "[[paper-b]]")
  assert.equal(a.sourcesEntry, "book-a-rates.md")
  assert.equal(a.summaryPage, "wiki/sources/book-a-rates.md")
  assert.equal(a.summaryLink, "[[book-a-rates]]")
  assert.equal(a.sections.length, 1)
  assert.equal(a.sourceChanged, false)

  // the model's part, simulated
  const page = (rel, fm, body) => fs.writeFileSync(path.join(vault, rel), `---\n${fm}\n---\n${body}\n`)
  page("wiki/sources/book-a-rates.md", `type: source\ntitle: "Book A: Rates"\nrelated: [term-premium]\nsources: ["book-a-rates.md"]`, "# Book A\n\nSee [[term-premium]].")
  page("wiki/concepts/term-premium.md", `type: concept\ntitle: Term Premium\nrelated: [repo-market, book-a-rates, missing-slug]\nsources: ["book-a-rates.md"]`, "# Term Premium\n\nExtra yield. From [[book-a-rates]].")
  page("wiki/concepts/imf-lending.md", `type: concept\ntitle: IMF Lending\nrelated: []\nsources: ["book-a-rates.md"]`, "# IMF Lending\n\nDescribed in book A.")
  page("wiki/concepts/repo-market.md", `type: concept\ntitle: Repo Market\nrelated: [term-premium]\nsources: ["book-a-rates.md", "paper-b.txt"]`, "# Repo Market\n\nShort-term funding. Unlike [[imf-lending]].")

  const fin = JSON.parse(W("finalize", vault, "book-a-rates.md"))
  assert.equal(fin.issueCounts.frontmatter, 0)
  const tp = fs.readFileSync(path.join(vault, "wiki/concepts/term-premium.md"), "utf8")
  assert.match(tp, /## Related\n\n- \[\[repo-market\|Repo Market\]\]\n<!-- llm-wiki:related:end -->/)
  assert.doesNotMatch(tp.split("llm-wiki:related:start")[1], /missing-slug|book-a-rates/) // unresolved and already-linked slugs are skipped
  const summary = fs.readFileSync(path.join(vault, "wiki/sources/book-a-rates.md"), "utf8")
  assert.match(summary, /## Pages From This Source\n\n### concepts\n\n- \[\[imf-lending\|IMF Lending\]\]\n- \[\[repo-market\|Repo Market\]\]/)
  // index.md: only appended to, in llm_wiki's own "Recently Updated" format
  const index = fs.readFileSync(path.join(vault, "wiki/index.md"), "utf8")
  assert.match(index, /^# Wiki Index\n\n## Recently Updated\n(- \[\[[a-z]+\/[a-z-]+\]\] — .+\n){4}$/)
  assert.match(index, /- \[\[concepts\/term-premium\]\] — Term Premium\n/)
  W("finalize", vault, "book-a-rates.md")
  assert.equal(fs.readFileSync(path.join(vault, "wiki/index.md"), "utf8"), index, "no duplicate index entries")
  const indexMtime = fs.statSync(path.join(vault, "wiki/index.md")).mtimeMs
  assert.deepEqual(JSON.parse(W("sync", vault)), { pages: 7, changed: 0 }, "sync is idempotent")
  assert.equal(fs.statSync(path.join(vault, "wiki/index.md")).mtimeMs, indexMtime, "sync never writes index.md")

  // an app re-ingest that drops or duplicates the markers must not leave two Related sections
  const tpFile = path.join(vault, "wiki/concepts/term-premium.md")
  const block = tp.slice(tp.indexOf("<!-- llm-wiki:related:start -->"))
  const unmarked = tp.replace(block, block.replace(/<!--.*?-->\n?/g, ""))
  fs.writeFileSync(tpFile, unmarked)
  W("sync", vault)
  assert.equal(fs.readFileSync(tpFile, "utf8"), unmarked, "unmarked leftover kept as page text, no second block")
  fs.writeFileSync(tpFile, tp + "\n" + block)
  W("sync", vault)
  assert.equal(fs.readFileSync(tpFile, "utf8"), tp, "duplicated block collapsed")
  const handWritten = tp.replace(block, "## Related\n\n- [[some-other-note]]\n")
  fs.writeFileSync(tpFile, handWritten)
  W("sync", vault)
  assert.match(fs.readFileSync(tpFile, "utf8"), /## Related\n\n- \[\[some-other-note\]\]\n\n<!-- llm-wiki:related:start -->/, "a user's own Related section is kept")
  fs.writeFileSync(tpFile, tp)

  // the same content under another name is not imported twice (#846)
  fs.copyFileSync(path.join(vault, "raw/sources/paper-b.txt"), path.join(inbox, "Paper B (1).txt"))
  const again = JSON.parse(W("add", vault, path.join(inbox, "Paper B (1).txt")))
  assert.match(again[0].note, /already in sources as paper-b\.txt/)
  assert.ok(!fs.existsSync(path.join(vault, "raw/sources/Paper B (1).txt")))

  // #838: unchanged re-ingest is not "changed"; edited source is
  assert.equal(JSON.parse(W("status", vault, "book-a-rates.md")).sourceChanged, false)
  fs.appendFileSync(path.join(vault, "raw/sources/book-a-rates.md"), "Correction.\n")
  assert.equal(JSON.parse(W("status", vault, "book-a-rates.md")).sourceChanged, true)
  assert.equal(b.sourceChanged, false)

  // mentions: other-source pages only
  assert.equal(W("mentions", vault, "paper-b.txt").trim(), "")

  // remove: dry run changes nothing
  const before = fs.readdirSync(path.join(vault, "wiki/concepts")).length
  assert.match(W("remove", vault, "book-a-rates.md"), /Dry run/)
  assert.equal(fs.readdirSync(path.join(vault, "wiki/concepts")).length, before)
  W("remove", vault, "book-a-rates.md", "--yes")
  assert.ok(!fs.existsSync(path.join(vault, "wiki/concepts/term-premium.md")))
  assert.ok(!fs.existsSync(path.join(vault, "wiki/sources/book-a-rates.md")))
  assert.ok(!fs.existsSync(path.join(vault, "raw/sources/book-a-rates.md")))
  const repo = fs.readFileSync(path.join(vault, "wiki/concepts/repo-market.md"), "utf8")
  assert.match(repo, /sources: \["paper-b\.txt"\]/)
  assert.match(repo, /related: \[\]/)
  assert.match(repo, /Unlike IMF Lending\./) // link to a deleted page becomes its title
  assert.doesNotMatch(repo, /llm-wiki:related/)
  const indexAfter = fs.readFileSync(path.join(vault, "wiki/index.md"), "utf8")
  assert.doesNotMatch(indexAfter, /term-premium|imf-lending|book-a-rates/) // entries for deleted pages dropped
  assert.match(indexAfter, /- \[\[concepts\/repo-market\]\] — Repo Market/)
  const trash = fs.readdirSync(path.join(vault, ".llm-wiki/trash"))
  assert.equal(trash.length, 1)
  assert.ok(fs.existsSync(path.join(vault, ".llm-wiki/trash", trash[0], "wiki/concepts/term-premium.md")))
  assert.ok(fs.existsSync(path.join(vault, ".llm-wiki/trash", trash[0], "raw/sources/book-a-rates.md")))
  assert.match(fs.readFileSync(path.join(vault, "wiki/log.md"), "utf8"), /^# Wiki Log\n\n## \[\d{4}-\d\d-\d\d\] delete \| book-a-rates\.md/)

  // log strips model-written frontmatter
  execFileSync(process.execPath, [SCRIPT, "log", vault, "ingest", "Paper B"], { input: "---\ntype: log\n---\n- one\n" })
  assert.match(fs.readFileSync(path.join(vault, "wiki/log.md"), "utf8"), /^# Wiki Log\n\n## \[[\d-]+\] ingest \| Paper B\n\n- one\n\n## \[/)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("index: repeated additions keep a single blank line before Recently Updated", async () => {
  const { addToRecentIndex } = await import("./wiki.mjs")
  const pg = (rel, title) => ({ rel, title })
  let idx = "# Wiki Index\n"
  for (const n of ["a", "b", "c"]) idx = addToRecentIndex(idx, [pg(`wiki/concepts/${n}.md`, n.toUpperCase())])
  assert.equal(idx, "# Wiki Index\n\n## Recently Updated\n- [[concepts/c]] — C\n- [[concepts/b]] — B\n- [[concepts/a]] — A\n")
})

// Minimal one-page PDF that says "Hello wiki"; xref offsets are computed so strict parsers accept it.
function tinyPdf() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  const stream = "BT /F1 12 Tf 20 50 Td (Hello wiki) Tj ET"
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let out = "%PDF-1.4\n"
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

let hasPdftotext = true
try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }) } catch (e) { hasPdftotext = e.code !== "ENOENT" }

test("PDFs with non-ASCII names are extracted", { skip: !hasPdftotext && "pdftotext not installed" }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
  const vault = path.join(tmp, "v")
  W("init", vault)
  const pdf = path.join(tmp, "Jane’s Notes – 期限溢价.pdf")
  fs.writeFileSync(pdf, tinyPdf(), "latin1")
  const [r] = JSON.parse(W("add", vault, pdf))
  assert.equal(r.extraction, "pdftotext", r.extractionProblem)
  assert.match(fs.readFileSync(path.join(vault, r.text), "utf8"), /Hello wiki/)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("short source names drop authors, publisher, hashes and subtitles", async () => {
  const { shortSourceName } = await import("./wiki.mjs")
  const cases = {
    "(Series Name) Jane Doe, John Roe - Fixed Income Basics_ Tools for Analysts (2022, Publisher) - example.org.pdf": "fixed-income-basics.pdf",
    "Alpha Factors Explained -- Doe, Jane -- Journal, 2015 -- 0123456789abcdef0123456789abcdef -- Some Archive.pdf": "alpha-factors-explained.pdf",
    "Portfolio Craft_ A Practitioner′s Guide{Jane Doe}(2021, Publisher){12345678} example.org-1.pdf": "portfolio-craft.pdf",
    "Macro_Trading_Reading_Guide.PDF": "macro-trading-reading-guide.pdf",
    "Money Markets - Jane Doe.pdf": "money-markets.pdf",
    "A Very Long Title Of Many Words For Testing.md": "a-very-long-title-of-many.md",
  }
  for (const [input, want] of Object.entries(cases)) assert.equal(shortSourceName(input), want, input)
})

test("source page names match the llm_wiki app's", async () => {
  const { appSummarySlug } = await import("./wiki.mjs")
  assert.equal(appSummarySlug("book-a-rates.md"), "book-a-rates")
  // expected values computed with llm_wiki's own sourceSummarySlugFromIdentity (src/lib/source-identity.ts)
  assert.equal(appSummarySlug("papers/Macro Trading Reading Guide.pdf"), "6-papers--27-macro-trading-reading-guide--qm531w")
  assert.equal(appSummarySlug("notes/2024/Jane’s Notes – 期限溢价.md"), "5-notes--4-2024--17-janes-notes-期限溢价--1f23mnj")
  assert.equal(appSummarySlug(`deep/deep/deep/${"a".repeat(300)}.pdf`), `4-deep--4-deep--4-deep--300-${"a".repeat(83)}--1wx1h8y`)
})

test("rename-source moves the file, cache and source page and repoints every reference", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
  const vault = path.join(tmp, "v")
  W("init", vault)
  const src = path.join(tmp, "Long Ugly Name -- Someone -- 2020.md")
  fs.writeFileSync(src, "text\n")
  const [r] = JSON.parse(W("add", vault, src))
  assert.equal(r.sourcesEntry, "long-ugly-name.md")
  const page = (rel, fm, body) => fs.writeFileSync(path.join(vault, rel), `---\n${fm}\n---\n${body}\n`)
  page("wiki/sources/long-ugly-name.md", `type: source\ntitle: Long\nrelated: []\nsources: ["long-ugly-name.md"]`, "# Long")
  page("wiki/concepts/c.md", `type: concept\ntitle: C\nrelated: [long-ugly-name, d]\nsource: long-ugly-name\nsources: ["long-ugly-name.md", "other.md"]`, "See [[long-ugly-name|the book]] and [[long-ugly-name#Ch 2]]. | [[long-ugly-name\|t]] |")
  page("wiki/concepts/d.md", `type: concept\ntitle: D\nrelated: [c]\nsources: ["other.md"]`, "D ![fig](media/long-ugly-name/fig1.png)")
  fs.mkdirSync(path.join(vault, "wiki/media/long-ugly-name"), { recursive: true })
  fs.writeFileSync(path.join(vault, "wiki/media/long-ugly-name/fig1.png"), "")
  fs.writeFileSync(path.join(vault, "wiki/index.md"), "# Wiki Index\n\n## Recently Updated\n- [[sources/long-ugly-name]] — Long\n")
  const out = JSON.parse(W("rename-source", vault, "long-ugly-name.md", "Short"))
  assert.equal(out.to, "short.md")
  assert.equal(out.summaryLink, "[[short]]")
  assert.ok(fs.existsSync(path.join(vault, "raw/sources/short.md")) && !fs.existsSync(path.join(vault, "raw/sources/long-ugly-name.md")))
  assert.ok(fs.existsSync(path.join(vault, "raw/sources/.cache/short.md.txt")))
  assert.match(fs.readFileSync(path.join(vault, "wiki/sources/short.md"), "utf8"), /sources: \["short\.md"\]/)
  const c = fs.readFileSync(path.join(vault, "wiki/concepts/c.md"), "utf8")
  assert.match(c, /related: \[short, d\]\nsource: short\nsources: \["short\.md", "other\.md"\]/)
  assert.match(c, /See \[\[short\|the book\]\] and \[\[short#Ch 2\]\]\. \| \[\[short\\|t\]\] \|/)
  assert.match(fs.readFileSync(path.join(vault, "wiki/index.md"), "utf8"), /- \[\[sources\/short\]\] — Long/)
  assert.ok(fs.existsSync(path.join(vault, "wiki/media/short/fig1.png")))
  assert.match(fs.readFileSync(path.join(vault, "wiki/concepts/d.md"), "utf8"), /!\[fig\]\(media\/short\/fig1\.png\)/)
  assert.ok(JSON.parse(fs.readFileSync(path.join(vault, ".llm-wiki/skill-sources.json"), "utf8"))["short.md"])
  assert.equal(JSON.parse(W("status", vault, "short.md")).sourceChanged, false)
  assert.doesNotMatch(W("lint", vault), /brokenLinks \([1-9]/)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("rename-source moves a nested source to the top level, so its page name is short", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
  const vault = path.join(tmp, "v")
  W("init", vault)
  fs.mkdirSync(path.join(vault, "raw/sources/.temp"), { recursive: true })
  fs.writeFileSync(path.join(vault, "raw/sources/.temp/Old Name -- X.md"), "text\n")
  const s = JSON.parse(W("status", vault, ".temp/Old Name -- X.md"))
  assert.match(s.summaryLink, /^\[\[\d+-temp--\d+-old-name-x--[a-z0-9]+\]\]$/)
  fs.writeFileSync(path.join(vault, s.summaryPage), `---\ntype: source\ntitle: Old\nsources: [".temp/Old Name -- X.md"]\n---\n# Old\n`)
  const r = JSON.parse(W("rename-source", vault, ".temp/Old Name -- X.md", "old-name"))
  assert.equal(r.to, "old-name.md")
  assert.equal(r.summaryLink, "[[old-name]]")
  assert.ok(fs.existsSync(path.join(vault, "raw/sources/old-name.md")))
  assert.ok(fs.existsSync(path.join(vault, "raw/sources/.cache/old-name.md.txt")))
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("links inside math and code are not graph edges", async () => {
  const { wikilinks } = await import("./wiki.mjs")
  const body = "Uses [[a]] on $[[t_{j,0},t_{j,1}]]$ and $$\n[[x]]\n$$ and `[[y]]`.\n```\n[[z]]\n```\nCosts $5 and [[b]] costs $10."
  assert.deepEqual(wikilinks(body), ["a", "b"])
})

test("init fills Obsidian's default graph.json but keeps a customized one", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
  const graph = path.join(tmp, ".obsidian/graph.json")
  fs.mkdirSync(path.dirname(graph), { recursive: true })
  fs.writeFileSync(graph, JSON.stringify({ search: "", colorGroups: [], repelStrength: 10, hideUnresolved: false }))
  W("init", tmp)
  const g = JSON.parse(fs.readFileSync(graph, "utf8"))
  assert.equal(g.repelStrength, 10)
  assert.equal(g.hideUnresolved, true)
  assert.ok(g.colorGroups.length > 0 && g.search.startsWith("path:wiki/"))
  const mine = { search: "tag:#x", colorGroups: [], repelStrength: 3 }
  fs.writeFileSync(graph, JSON.stringify(mine))
  W("init", tmp)
  assert.deepEqual(JSON.parse(fs.readFileSync(graph, "utf8")), mine)
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("CESU-8 surrogate pairs from pdftotext become real UTF-8", async () => {
  const { fixCesu8 } = await import("./wiki.mjs")
  // pdftotext on Windows writes 𝛼 (U+1D6FC) as two 3-byte surrogates: ED A0 B5 ED BB BC
  const cesu = Buffer.concat([Buffer.from("x = "), Buffer.from([0xed, 0xa0, 0xb5, 0xed, 0xbb, 0xbc]), Buffer.from(" + β\n")])
  assert.equal(fixCesu8(cesu).toString("utf8"), "x = 𝛼 + β\n")
  const plain = Buffer.from("no change: ü 期限\n")
  assert.equal(fixCesu8(plain), plain)
})

test("parallel script calls on one vault don't lose each other's manifest updates", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
  const vault = path.join(tmp, "v")
  W("init", vault)
  fs.writeFileSync(path.join(tmp, "a.md"), "# A\n\nsome text\n")
  const [{ sourcesEntry }] = JSON.parse(W("add", vault, path.join(tmp, "a.md")))
  const run = (...args) => new Promise((ok, fail) => execFile(process.execPath, [SCRIPT, ...args], (e) => (e ? fail(e) : ok())))
  const ns = Array.from({ length: 12 }, (_, i) => i + 1)
  await Promise.all(ns.map((n) => run("done", vault, sourcesEntry, String(n))))
  assert.deepEqual(JSON.parse(W("status", vault, sourcesEntry)).sectionsDone, ns)
  assert.equal(fs.existsSync(path.join(vault, ".llm-wiki", "lock")), false)
  fs.writeFileSync(path.join(vault, ".llm-wiki", "lock"), "999999") // a crashed run's lock doesn't block
  W("done", vault, sourcesEntry, "13")
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("init --template; add flags purpose.md until it has a line of its own", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-"))
  const vault = path.join(tmp, "v")
  W("init", vault, "--name", "Rates", "--template", "research")
  assert.ok(fs.existsSync(path.join(vault, "wiki/findings")))
  assert.match(fs.readFileSync(path.join(vault, "purpose.md"), "utf8"), /^# Project Purpose — Rates\n\n## Research Question/)
  fs.writeFileSync(path.join(tmp, "a.md"), "Term premium.\n")
  assert.equal(JSON.parse(W("add", vault, path.join(tmp, "a.md")))[0].purposeUnfilled, true)
  // headings and lines from any template don't count as filled in
  fs.appendFileSync(path.join(vault, "purpose.md"), "\n## Goal\n\n-\n> TBD\n")
  assert.equal(JSON.parse(W("status", vault, "a.md")).purposeUnfilled, true)
  fs.appendFileSync(path.join(vault, "purpose.md"), "\r\nWhy do long rates move? English.\r\n")
  assert.equal(JSON.parse(W("status", vault, "a.md")).purposeUnfilled, undefined)
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, "init", path.join(tmp, "w"), "--template", "nope"], { stdio: "pipe" }), /unknown template/)
  fs.rmSync(tmp, { recursive: true, force: true })
})
