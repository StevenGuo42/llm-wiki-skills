# Wiki Schema — {{NAME}}

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | wiki/entities/ | Named things (people, tools, organizations, datasets) |
| concept | wiki/concepts/ | Ideas, techniques, phenomena, frameworks |
| source | wiki/sources/ | Papers, articles, talks, books, blog posts |
| query | wiki/queries/ | Open questions under active investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis of related entities |
| synthesis | wiki/synthesis/ | Cross-cutting summaries and conclusions |
| overview | wiki/ | High-level project summary (one per project) |
| character | wiki/characters/ | People and figures in the book |
| theme | wiki/themes/ | Recurring ideas, motifs, and symbolic threads |
| plot-thread | wiki/plot-threads/ | Storylines or narrative arcs being tracked |
| chapter | wiki/chapters/ | Per-chapter notes and summaries |

## Naming Conventions

- Files: `kebab-case.md`, unique across the whole wiki (Obsidian resolves `[[slug]]` by file name, so `concepts/x.md` and `entities/x.md` collide)
- Entities: match official name where possible (e.g., `openai.md`, `gpt-4.md`)
- Concepts: descriptive noun phrases (e.g., `chain-of-thought.md`)
- Sources: the skill sets the source page path from the file name; link to it with the exact link the ingest step prints
- Queries: question as slug (e.g., `does-scale-improve-reasoning.md`)
- Characters: character name in kebab-case (e.g., `elizabeth-bennet.md`)
- Themes: thematic noun phrase (e.g., `social-class-mobility.md`, `deception-vs-honesty.md`)
- Plot threads: arc description (e.g., `darcys-redemption-arc.md`)
- Chapters: `ch-NN-slug.md` (e.g., `ch-01-opening-scene.md`)

## Frontmatter

All pages:

```yaml
---
type: entity | concept | source | query | comparison | synthesis | overview | character | theme | plot-thread | chapter
title: Human-readable title
aliases: []
tags: []
related: []        # bare slugs; drawn as graph edges via the page's Related section
sources: []        # raw source files (path under raw/sources) that contributed
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Quote any value containing `: ` or ` #`, e.g. `title: "Capital Budgeting: NPV and IRR"`. An unquoted colon makes the whole frontmatter invalid and the page loses its type and links.

Source pages also include:

```yaml
authors: []
year: YYYY
url: ""
venue: ""
```

Character pages also include:

```yaml
first_appearance: "Ch. N"
role: protagonist | antagonist | supporting | minor
```

Chapter pages also include:

```yaml
chapter: N
pages: "1-24"
```

## Index Format

`wiki/index.md` is maintained by the tools, not by hand. New pages are added to its `## Recently Updated` section:
```
- [[folder/page-slug]] — Title
```

## Log Format

`wiki/log.md` records activity in reverse chronological order:
```
## [YYYY-MM-DD] ingest | Source Title

- Action taken / finding noted
```

## Cross-referencing Rules

- Use `[[page-slug]]` syntax to link between wiki pages
- Queries link to the sources and concepts they draw on
- Synthesis pages cite all contributing pages via `related:`
- Chapter notes reference characters appearing in that chapter via `related:`
- Theme pages link to the chapters where the theme is most prominent
- Plot thread pages list chapters that advance the arc

## Contradiction Handling

When sources contradict each other:
1. Note the contradiction in the relevant concept or entity page, attributing each side to its source
2. Create or update a query page to track the open question
3. Link both sources from the query page
4. Resolve in a synthesis page once sufficient evidence exists

## Reading-Specific Conventions

- Chapter pages are written during or immediately after reading — capture fresh reactions
- Distinguish between plot summary and personal interpretation in chapter notes
- Theme pages should track *development* across the book, not just state that a theme exists
- Flag unresolved plot threads with status: `open` until resolved
- Note page numbers for important quotes to enable re-finding later
