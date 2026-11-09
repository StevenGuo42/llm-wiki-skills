---
name: llm-wiki
description: Use when building or maintaining an LLM-written knowledge graph / wiki (Karpathy "LLM Wiki" pattern, nashsu/llm_wiki layout) in an Obsidian vault — creating a wiki, adding (ingesting) one or many sources such as PDFs, papers, books, articles or notes, removing a source and the pages that came only from it, fixing broken links or frontmatter, or making the graph show up in Obsidian.
---

# LLM Wiki

You maintain a persistent, interlinked markdown wiki compiled from the user's sources. You read
sources and write pages. `scripts/wiki.mjs` does the bookkeeping that must be exact: importing,
text extraction, sectioning, finding existing pages, cascade delete, Related sections, index entries,
and lint. It only appends to pages and the index. It never rewrites what the llm_wiki app or you wrote.

**Vault layout** (compatible with the llm_wiki desktop app, so a vault can be used by both):

```
<vault>/
  purpose.md          goal, reader, language, scope. Read it before every ingest.
  schema.md           page types → folders, frontmatter, naming. AUTHORITATIVE for routing.
  raw/sources/        immutable source files (any subfolders). Text cache: <dir>/.cache/<file>.txt
  wiki/index.md       owned by the app; the script only adds new pages to its "## Recently Updated"
  wiki/log.md         newest first; written through `wiki.mjs log`
  wiki/overview.md    high-level summary you keep current
  wiki/<type>/*.md    pages; wiki/sources/*.md = one summary page per source
  .llm-wiki/skill-sources.json   the script's source hashes and section progress
```

**Running the script.** `W` below means `node "<this skill's base directory>/scripts/wiki.mjs"`,
using the base directory printed when this skill loads. Needs Node 18+. PDFs need `pdftotext` (poppler).
Always quote paths, since vault names often contain spaces and commas.

| Command | What it does |
|---|---|
| `W init <vault> [--name N]` | New vault, or upgrade an existing one: adds missing purpose/schema/dirs and the Obsidian graph config. Never overwrites existing pages, purpose or schema; only adds missing Obsidian settings |
| `W add <vault> <file-or-folder>... [--name N]` | Copy into raw/sources under a short name (skips a file whose content is already there), extract text, print the ingest plan as JSON |
| `W rename-source <vault> <source> <short-name>` | Give a source a short name. Moves the file (to the top of raw/sources, so the app names its page after it), its text cache and its source page, and repoints every link and image path |
| `W status <vault> <source>` | The same plan for a file already in raw/sources (also lists `pagesFromThisSource`) |
| `W mentions <vault> <source> [--section N]` | Existing pages *from other sources* named in that text, ranked |
| `W done <vault> <source> <N>` | Record a finished section, so an interrupted ingest can resume |
| `W finalize <vault> <source>` | Record the ingest, refresh Related blocks and the source page list, add new pages to the index, then lint |
| `W remove <vault> <source>... [--yes]` | Cascade delete. Dry run unless `--yes` |
| `W sync <vault> [--dry-run]` | Refresh the Related blocks for the whole vault (never touches index.md or page text) |
| `W lint <vault> [--language English]` | Bad frontmatter, broken links, ambiguous names, orphans, unresolved `related` |
| `W log <vault> <action> <title>` | Prepend a log entry. Pipe the bullet list on stdin |
| `W quote <text>` | Print a YAML-safe frontmatter value, e.g. for a title with a colon |

`<source>` can be the path under raw/sources, a vault-relative path, an absolute path, or a bare file name.

## Operations

### Create a wiki
1. Ask for the vault folder and the topic, unless they're already given.
2. `W init "<vault>" --name "<Topic>"`.
3. Fill in `purpose.md` with the user (goal, reader, output language, key questions, scope). Adapt
   `schema.md` page types to the domain, for example method/finding/indicator for research. Every
   type row needs a `wiki/<folder>/` directory. After changing types, re-run `init` to create the folders.

### Add sources: follow `references/ingest.md`
Read `references/ingest.md` in full before ingesting. It covers section-by-section generation of
long sources, reusing existing pages, merge rules and page format. Ingest extracts knowledge only:
front and back matter, exercises, worked examples, appendices and filler are skipped unless
`purpose.md` asks for them. Several sources: ingest them
**one at a time**, in the order given, so each one sees the pages the earlier ones wrote.

### Remove a source
1. `W remove "<vault>" "<source>"` runs as a dry run. It lists the pages it will delete (pages whose
   `sources` cite only the removed sources) and the shared pages that only lose that `sources` entry.
2. Show the user the counts and the deleted list, and get a yes. This deletes content. Skip the
   question only if the user already told you to go ahead.
3. `W remove "<vault>" "<source>" --yes`. This moves the raw file, its text cache, the deleted pages and
   source media to `.llm-wiki/trash/<timestamp>/`, so they can be restored. It also turns `[[links]]`
   to deleted pages into plain text, drops deleted slugs from `related`, removes their index entries and logs the delete.
4. Shared pages keep the claims that came from the removed source, as llm_wiki does. If the user wants
   those gone too, grep the kept pages for the source's title or summary slug and edit out the
   attributed claims. Then update `wiki/overview.md` if it mentions the source.

### Make the graph visible in Obsidian
Obsidian draws edges only for `[[wikilinks]]`. Bare slugs in `related:` don't count. To fix this,
`sync` and `finalize` keep a script-owned `## Related` block at the end of each page, holding the
`related` slugs that aren't already linked in the body. Source pages also get a `## Pages From This
Source` block listing any of the source's pages the summary doesn't already link, so every page
links back to its book. When the summary links them all, no block is added.

This stays compatible with the llm_wiki app. The app's graph also reads body links, and the block is
plain markdown that the app ignores otherwise. If an app re-ingest rewrites a page and drops the
markers, the leftover list stays as ordinary text and no duplicate is added.

For an existing vault, including one built with the llm_wiki app:
1. `W init "<vault>"` adds `.obsidian/graph.json` if it's missing. That sets colors by page folder,
   shows only `wiki/`, and hides index/log and unresolved links. It also adds `.cache` and `.llm-wiki`
   to Obsidian's ignore filters. If Obsidian is open, close the graph view first.
2. `W sync "<vault>" --dry-run`, then `W sync "<vault>"`.
3. Tell the user to open the vault folder in Obsidian, then the graph view (Ctrl/Cmd+G).

### Health check
`W lint "<vault>"`, then fix what it finds:
- frontmatter: quote the value, and turn `[[x]]` inside arrays into bare slugs.
- ambiguous names: merge the two pages into one and fix links.
- broken links: create the page if it's worth having, otherwise unlink it.
- orphans: link them from related pages.

Re-run `sync` afterwards. For content quality (contradictions, stale claims, missing pages), read
the pages involved and fix them, or record the issue in a `query` page.

## Rules that always apply
- `raw/` is read-only, apart from `add` and `remove`.
- Never write `wiki/index.md` and never edit inside `<!-- llm-wiki:... -->` blocks. The script owns them.
- Never delete or shrink a page by hand to "clean up". Merge instead.
- Human-owned fields that the schema names (e.g. `mastery`, `status`) are never changed.
