# llm-wiki skill for Claude Code

Version 0.1.0

Builds and maintains an LLM-written knowledge graph from your own sources (PDFs, papers, books,
articles, notes) as an Obsidian vault. It follows Andrej Karpathy's
[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) idea and the
[LLM Wiki desktop app](https://github.com/nashsu/llm_wiki)'s vault layout by Yong Su (nashsu), so the
same vault opens in Obsidian and in the app.

Claude reads each source and writes the pages. A small Node script, `llm-wiki/scripts/wiki.mjs`
(no dependencies), does the bookkeeping that has to be exact: importing, text extraction, finding
existing pages, cascade delete, graph links and lint.

## Install

```bash
# copy (or symlink) the skill into your user skills folder
cp -r llm-wiki ~/.claude/skills/llm-wiki
```

Requirements:
- Node 18+
- `pdftotext` for PDFs, from poppler (`brew install poppler`, `apt install poppler-utils`; on Windows
  the copy bundled with Git for Windows works). Without it, Claude extracts the text itself.

## Use

Ask Claude in plain language:

- "Create an LLM wiki about monetary economics in `~/vaults/money`"
- "Add these sources to my wiki: a.pdf, b.pdf, the folder ./papers"
- "Remove *Book Title* from the wiki"
- "Make my wiki's graph show up in Obsidian" / "lint my wiki"

Then open the vault folder in Obsidian and press Ctrl/Cmd+G for the graph.

## What it does

| Feature | Command |
|---|---|
| Add many sources (files or folders). Each is ingested in turn and sees the pages earlier ones wrote. Long sources are done section by section and can resume | `add`, `status`, `mentions`, `done`, `finalize` |
| Short, readable source names (the source page is a graph node named after the file); duplicates are detected by content | `add --name`, `rename-source` |
| Knowledge only: front and back matter, exercises, worked examples, appendices and filler are skipped unless `purpose.md` asks for them | ingest rules |
| Remove a source: delete pages only it supports, drop it from shared pages, unlink deleted pages, back everything up to `.llm-wiki/trash/` | `remove` (dry run first) |
| Obsidian graph: a `## Related` block of `[[links]]` kept in sync with each page's `related:` (bare slugs aren't graph edges), graph colored by page type | `sync`, `init` |
| Lint: frontmatter the app can't parse, broken links, ambiguous names, orphans | `lint` |

It only adds to a vault: new pages go into the app's own index section, and Related blocks are
appended at page ends. Frontmatter, `index.md` and page text the app or you wrote are never rewritten.

## Fixes carried over from llm_wiki pull requests

These fixes were proposed upstream and were still open as of November 2026. This skill implements
the same behaviour:

| PR | Behaviour here |
|---|---|
| [#834](https://github.com/nashsu/llm_wiki/pull/834) `]` inside quoted frontmatter array items | Quote-aware array scanner. Splice-based writes, so `$&` in file names stays literal |
| [#836](https://github.com/nashsu/llm_wiki/pull/836) keep titles valid when written back | Values are quoted only when needed; lint flags unquoted `: ` titles |
| [#838](https://github.com/nashsu/llm_wiki/pull/838) merge, don't replace, when the source is unchanged | `sourceChanged` is true only when a recorded hash differs; otherwise pages are merged |
| [#839](https://github.com/nashsu/llm_wiki/pull/839) show existing pages from this and other sources | `pagesFromThisSource`, and `mentions` ranks other sources' pages named in the text |
| [#842](https://github.com/nashsu/llm_wiki/pull/842) keep English pages that gloss terms in Chinese | Ingest rule; lint flags a page only when CJK is ≥20% of its letters |
| [#843](https://github.com/nashsu/llm_wiki/pull/843) no frontmatter in log entries | `log` strips a leading YAML block |
| [#844](https://github.com/nashsu/llm_wiki/pull/844) exact link for the source page | `add`/`status` print `summaryLink`, which is used everywhere |
| [#846](https://github.com/nashsu/llm_wiki/pull/846) generate long sources section by section | Section plan with resume, summary written last, "Pages From This Source" block, same-name merge, duplicate-import skip |

## Known limits

- Tested on Windows with Obsidian and one Claude model; not yet tried on macOS or Linux.
- Not yet verified by opening a vault in the llm_wiki app after the skill renamed its sources.
- Removing a source leaves its claims in the text of pages other sources also support (as the app does).
- What counts as "knowledge" versus filler is Claude's judgement; each source page lists what was skipped.
- Scanned PDFs, docx and epub have no built-in extractor; Claude has to produce the text.

## Test

```bash
node --test llm-wiki/scripts/wiki.test.mjs
```

## Credits

- [Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): the LLM Wiki
  pattern (raw sources → an LLM-maintained wiki → a schema that governs it).
- [Yong Su (nashsu)](https://github.com/nashsu/llm_wiki): the LLM Wiki desktop app, whose vault layout,
  schema template, source-page naming and ingest design this skill follows and partly ports.

## License

GPL-3.0-only (see [LICENSE](LICENSE)). Parts of the script and the default schema template are
ported from [LLM Wiki](https://github.com/nashsu/llm_wiki), Copyright (C) 2024-2026 Yong Su,
licensed under GPL-3.0.
