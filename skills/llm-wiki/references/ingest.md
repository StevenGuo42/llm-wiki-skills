# Ingest a source

`W` = `node "<skill base dir>/scripts/wiki.mjs"`. Quote every path.

## 1. Import and plan

```
W add "<vault>" "<file or folder>"        # new files
W add "<vault>" "<file>" --name "<short-name>"   # one file, with a name you choose
W status "<vault>" "<source>"             # already in raw/sources, or resuming
```

**Names.** `add` copies each file into `raw/sources/` under a short kebab-case name. The llm_wiki app
names the source page (a graph node) after that file, so the name must be the work's short title:
`101-formulaic-alphas.pdf`, `pozsar-shadow-banking.pdf`, `fixed-income-securities.pdf`. Without
`--name`, `add` guesses one from the file name. Check every `sourcesEntry`. If it is cut mid-phrase,
not the title, or ambiguous (two volumes with the same name), fix it **before writing any page**:

```
W rename-source "<vault>" "<current sourcesEntry>" "<short-name>"   # e.g. comomentum, cfa-2025-l1-quants
```

At most 5 words, no authors, years or publishers unless needed to tell works apart. Then use the
new `sourcesEntry` and `summaryLink` it prints.

The JSON gives you, per source:

| Field | Use |
|---|---|
| `sourcesEntry` | the exact string every page from this source puts in `sources:` |
| `summaryPage`, `summaryLink` | the source page's path, and **the exact link** to use for it everywhere: body links, `related`, and `source:` fields. Use it even if the schema describes source names differently |
| `text`, `sections` | the extracted text and its sections (`startLine`–`endLine`, 1-based) |
| `sectionsDone` | sections already finished by an interrupted run. Skip them. `finalize` resets it to `[]` |
| `sourceChanged` | `true` only if this source was ingested before with different content |
| `pagesFromThisSource` | pages that already cite this source (a re-ingest or resume) |
| `note` | "already in sources": a duplicate wasn't copied, and the existing copy is used |
| `purposeUnfilled` | present (`true`) only while `purpose.md` has nothing the user wrote |

**`purposeUnfilled` stops the ingest before any page is written.** Without a filled-in purpose there is
no goal, scope or output language to follow. Set up `purpose.md` with the user first (SKILL.md, Create
a wiki, step 4), then run `status` again. If the user wants to skip that, write the goal, reader and
output language from what they've told you and the sources, show them, and continue. If you can't ask
the user (you are a subagent), stop and report it.

If `extraction` is `needs-text`, `extractionProblem` says why (a scanned PDF, docx, epub, missing
`pdftotext`, …). Produce the text yourself: read the file with your tools, write plain text to the
`text` path, then run `status`. If `pdftotext` isn't installed, tell the user to install poppler,
or read the PDF in page ranges.

Then read `purpose.md` and `schema.md` (if you haven't already). `wiki/index.md` can be huge, so don't read it whole. Use
`mentions`, `pagesFromThisSource`, and Grep/Glob over `wiki/` to find existing pages.

## 2. Generate section by section

**Extract knowledge only.** The wiki holds what the source teaches about its subject: definitions,
mechanisms, methods, formulas, empirical results, and arguments with their evidence. Everything else
is skipped by default. Skipped material gets no pages, supplies no numbers, and isn't evidence:

| Skip | Examples |
|---|---|
| Front and back matter | title and copyright pages, dedication, acknowledgments, a preface or foreword that only describes the book, "how to use this book", table of contents, about the author, publisher ads, bibliography and reference lists, glossary, index |
| Teaching apparatus | learning objectives, chapter summaries and key-term lists that repeat the chapter, review questions, exercises and problems, solutions and answer keys, worked examples and case studies that only apply a method to made-up numbers |
| Appendices | all of them, unless listed as included |
| Filler inside the text | anecdotes and asides that support no claim, motivational or promotional passages, opinion with no argument behind it, passing name-drops, navigation ("as we saw in Chapter 3") |

Keep knowledge wherever it sits. Examples: a preface that states the book's thesis, an appendix
derivation the main text depends on, a historical episode the source uses as evidence, or a reference
that names the study behind a claim (cite it on that claim's page). The test: would a reader of this
wiki learn something about the subject from it? Include a whole skipped category only when
`purpose.md` lists it under **Include when ingesting**.

**Examples and exercises: keep the result, drop the numbers.**
- An exercise that states a result ("show that put-call parity holds…") states knowledge. Keep the
  statement on the result's page, without the exercise's numbers or solution.
- An example that is the source's only explanation of a mechanism: describe the mechanism in words,
  without its numbers.
- Real data the source presents as evidence (an actual index, firm or episode) is not a made-up
  example. Keep it with its numbers and period.
- Don't replace a skipped example with one of your own.
- A real figure mixed with a made-up assumption (an actual quote, then "assume a 5% loan rate"):
  keep the real figure and what the source concludes from it, and drop the assumption and every
  number derived from it.

**Orchestrator only** (the agent running the whole ingest; a section subagent skips this paragraph):
find skipped parts from the table of contents near the top of the `text` file and by Grepping it for
lines like `^(Preface|Foreword|Acknowledg|About the Author|Contents|Appendix|Exercises|Problems|Review Questions|Summary|Key Terms|Solutions|Answers|Bibliography|References|Glossary|Index|Example \d|Worked Example)`.
Read a section that lies entirely in skipped material only enough to confirm that, then mark it
`done` yourself, without a subagent. When only part of a section is skipped (e.g. it ends in a
Solutions chapter), give the subagent just the lines to ingest. List what you skipped on the source
summary page ("Not ingested: front matter, end-of-chapter problems, Appendices A–C, index").

A long source must produce pages in proportion to its length. Don't squeeze a book into one
pass. For **each section not in `sectionsDone`, in order**:

1. Read lines `startLine`–`endLine` of the `text` file. Use Read calls of about 300 lines: dense
   extracted text can exceed Read's output limit well before 2000 lines. The section `heading` is
   only the section's first line of text, and may be junk.
2. `W mentions "<vault>" "<source>" --section N` lists existing pages from other sources that this
   section names. Output: one `count<TAB>path<TAB>title` line per page, most-mentioned first; no
   output means no matches. Matching is by keyword, so check each candidate is really the same topic
   before merging. When you write about the same topic, **reuse that page's exact path and title**
   and merge into it. Don't create a new slug. A listed page that's a different topic with a
   similar name stays separate.
3. `mentions` never lists pages that already cite this source, including those you wrote in earlier
   sections. Keep your own list of them (or re-run `status` for `pagesFromThisSource`); they get
   **extended**, not duplicated.
4. Analyze the section, without writing the analysis down:
   - Named entities. For each, decide `page-worthy: yes/no`. Page-worthy means it is central, recurs,
     carries substantive claims, or is reusable across the wiki. Passing mentions, generic roles,
     chapter labels and story props are not page-worthy; mention them in prose only.
   - Concepts, methods and other schema types the section really contains (finding, indicator, …).
     Never invent goals, results or entries the source doesn't support.
   - Secondhand claims (a review, reading list or textbook reporting another work's results) are
     attributed as such ("as reported by …"). Don't make them findings of the original study.
   - Main claims and their evidence, contradictions with existing pages, and internal caveats.
5. Write the pages (rules below). Then run `W done "<vault>" "<source>" N`.

Sections stay sequential: a later section has to see the earlier sections' pages. With 3 or fewer
sections, do them yourself. With more than 3 sections, keep your own context small by giving each
section to a subagent, **one at a time**. Wait for each to finish before starting the next. A
400,000-character book takes about an hour and 1M tokens this way; tell the user before you start.
Fix the date once at the start and use it for every page of this ingest, even past midnight.
Brief (fill in every `…`):

> You are ingesting section N of `<source>` into the LLM wiki at `<vault>`. First read
> `<vault>/purpose.md` and `<vault>/schema.md`, then `<skill dir>/references/ingest.md` sections 2–3,
> and follow them exactly, except: do this section yourself, don't hand it to another agent, and skip
> the paragraphs marked "Orchestrator only". Script: `node "<skill dir>/scripts/wiki.mjs"`. Source
> facts: sourcesEntry=`…`, summaryLink=`…`, text file `…`, lines A–B. Output language: … . Use the
> date YYYY-MM-DD for `created`/`updated`. Pages from earlier sections (paths): … . Left over from the
> previous section: … . Write only inside `<vault>/wiki/`. Don't write the source summary page, the
> log, the overview or learning paths. When done, run `done` for section N and reply with five lists:
> pages created, pages updated (path — title, one line each), what you skipped (e.g. "Ex. 2.1–2.39,
> numbers of Examples 2.3–2.6"), what the next section should finish, and notes for the final pass
> (learning-path steps, overview changes, caveats for the summary).

Keep the replies: the skipped lists build the summary's "Not ingested" line, "next section" goes in
the next brief, and the final-pass notes wait for §4. Take the page list for each brief, and the
page counts, from `status` → `pagesFromThisSource`, not from the replies.

## 3. Page rules

**File names are short:** the page's topic in at most 5 words, kebab-case (`term-premium`,
`hierarchy-of-money`). Put detail in `title`, not the file name: the file name is the node label in
Obsidian's graph.

**Before creating a page**, Glob `wiki/**/<slug>.md`. File names must be unique across the whole wiki
(`[[slug]]` resolves by file name). If the name already exists in another folder, merge into that
page instead of creating a second one. Also check titles and `aliases`, including aliases in other
languages.

**Other ingests may be writing to the vault at the same time.** The script takes turns by itself;
your page edits must be safe too:
- Glob for the slug right before you create a page, and create it in your very next step.
- Write whole files only to create new pages. Change an existing page only with Edit, which replaces
  just the text you name, so other agents' changes elsewhere in the file survive. Never write back a
  whole page you read earlier, and never change pages with shell redirection or `sed`.
- If an Edit fails because its text is no longer there, read the page again and redo the edit.
- At the end of each section, before `done`, run `status` and check that every page you created or
  updated is in `pagesFromThisSource`. A missing page was overwritten by a parallel ingest: read it
  and merge your content back in.

**New page.** Write it with this frontmatter. The first line is exactly `---`, with no code fence and
nothing before it:

```yaml
---
type: concept                 # must match the schema folder the file is in
title: Term Premium           # quote it if it contains ": " or " #" → use `W quote "<title>"`
aliases: []
tags: [rates, yield-curve]
related: [expectations-hypothesis, acm-term-premium]   # bare slugs only: no [[ ]], no wiki/, no .md
sources: ["<sourcesEntry>"]
created: YYYY-MM-DD           # the ingest date (fixed at its start)
updated: YYYY-MM-DD
---
```

Add any extra fields the schema requires for that type. Every slug in a schema link field
(`prerequisites`, `evidence`, `source`, …) also goes in `related`. Arrays are inline `[a, b]`. Quote
an item that contains a comma, bracket, colon, `#` or quote.

**Existing page. Merge, don't replace.** Read it, then Edit it so that:
- every factual claim from the old and new material survives, said once, with sections reorganized
  logically instead of appended ("Additional info from …" headings are not allowed);
- `type`, `title`, `created` and human-owned fields (e.g. `mastery`, `status`) keep their current values;
- `sources` adds the `sourcesEntry` (union, no duplicates), and `related`/`tags` are unions;
- `updated` is the ingest date.

Only when `sourceChanged` is `true` **and** the page's `sources` list holds only this source may you
rewrite the body from the corrected source. In every other case, including an unchanged re-ingest
and a source with no earlier record, merge. A fresh rewrite is usually shorter and loses content.

**Body.**
- Link with `[[slug]]` or `[[slug|label]]` in the body. Link the source page with `summaryLink`.
- Keep subject boundaries. A claim, limitation or benchmark result stays on the page of the exact
  subject it is about. Don't move a claim about one model, method or person onto another because
  they share a keyword. For a comparison, write it as an explicit comparison.
- Never invent numbers, citations, URLs, results or examples. Anything the source doesn't state goes
  in a paragraph that starts with **Derived (not in the source):**. That covers stable public
  background facts and your own steps between the source's statements; never numbers. Skipped
  material (solutions, worked examples) doesn't count as the source stating it.
- If the schema's page template has an Example section and the source gives no example you may keep,
  leave the section out; don't write an illustrative one. Code the schema asks for (e.g. a method's
  implementation) is allowed if it follows the source's formula exactly and is labelled as derived.
- Keep exact tables, formulas, schemas and code verbatim, in code blocks or tables. Extracted PDF text
  often garbles formulas (lost fractions, subscripts, ≠) and drops equations stored as images. When
  one looks broken or missing, look at the page itself:
  `pdftoppm -f <page> -l <page> -r 110 -singlefile -png "<original pdf>" "<vault>/.llm-wiki/tmp/p"`,
  then Read `p.png` as an image and copy from it. The text file has a form feed between PDF pages, so
  `awk 'BEGIN{RS="\f"} /EQ 3-4/{print NR}' "<text file>"` lists the PDF pages that mention a string.
  The first hits are often the contents or a cross-reference: render each until you find the page
  that actually prints it.
  Without `pdftoppm`, try `pdftotext -f <page> -l <page> -layout "<original pdf>" -`. If it still
  can't be recovered, write what you are sure of and add exactly this line under it:
  `> [!warning] Formula reconstructed; check against the source.`
- An entity page opens by saying what the subject is. If the source doesn't establish that, use only
  stable, well-known public facts, labelled as background. If identity is still unclear, don't
  create the page.
- Language: write prose in the purpose's output language. Glossing a term in another script, such as
  "**term premium**" with a Chinese alias, is fine and is not a reason to drop or rewrite a page.
  Follow the schema on where glosses go (e.g. `aliases` only).
- Don't write `wiki/index.md`, or anything inside `<!-- llm-wiki:… -->` blocks.

## 4. Final pass: source page, overview, log

After all sections are done:

1. Write the **source summary page** at `summaryPage`, merging if it exists. Use `type: source` and
   `sources: ["<sourcesEntry>"]`, plus the schema's source fields (authors, year, venue, …). Body: the
   thesis or what the source is, the structure (a chapter → pages map for books: every chapter row
   links the pages it produced), key claims as reported, caveats on evidence quality, and open
   questions. Write exactly one source page, and none for works the source merely cites. If a schema
   field has no value in the source (no author named, no matching `source_kind`), leave it empty or
   pick the closest value, and say so in the body; never invent it.
2. Learning paths: create or update them now (using the subagents' final-pass notes), following the schema, with this source's concepts in
   the source's order. Keep each path's `goal` true to all its steps; start a new path rather than
   stretching one past its goal.
3. Update `wiki/overview.md` briefly if the source changes the big picture. Edit it; don't rewrite it.
4. `W finalize "<vault>" "<source>"`. This records the source hash, rebuilds the Related blocks, the
   summary's "Pages From This Source" list, adds this source's new pages to the index's "Recently Updated" section, and lints. Fix what it reports:
   - `duplicateNames`: merge the pair into one page, keeping the older path, and fix links.
   - `frontmatter`: quote values, and use bare slugs in arrays.
   - `brokenLinks` from your pages: create the page if it's page-worthy, otherwise unlink it.

   Run `W sync "<vault>"` again after fixes.
5. Log. The body holds bullets only, with no frontmatter and no heading (the script adds the heading):
   ```
   printf '%s\n' "- Ingested … (N sections); created X pages, updated Y." "- Caveats: …" | W log "<vault>" ingest "<Source title>"
   ```
6. Tell the user: pages created and updated (counts and the main ones), contradictions or open
   questions worth their judgement, and any `needs-text` or lint items you couldn't resolve.
