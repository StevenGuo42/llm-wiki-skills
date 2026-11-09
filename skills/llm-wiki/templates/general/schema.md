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

## Naming Conventions

- Files: `kebab-case.md`, unique across the whole wiki (Obsidian resolves `[[slug]]` by file name, so `concepts/x.md` and `entities/x.md` collide)
- Entities: match official name where possible (e.g., `openai.md`, `gpt-4.md`)
- Concepts: descriptive noun phrases (e.g., `chain-of-thought.md`)
- Sources: the skill sets the source page path from the file name; link to it with the exact link the ingest step prints
- Queries: question as slug (e.g., `does-scale-improve-reasoning.md`)

## Frontmatter

All pages:

```yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
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

## Contradiction Handling

When sources contradict each other:
1. Note the contradiction in the relevant concept or entity page, attributing each side to its source
2. Create or update a query page to track the open question
3. Link both sources from the query page
4. Resolve in a synthesis page once sufficient evidence exists
