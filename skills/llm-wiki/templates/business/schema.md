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
| meeting | wiki/meetings/ | Meeting notes, agendas, and action items |
| decision | wiki/decisions/ | Architectural or strategic decisions (ADR-style) |
| project | wiki/projects/ | Project briefs, status, and retrospectives |
| stakeholder | wiki/stakeholders/ | People, teams, and organisations involved |

## Naming Conventions

- Files: `kebab-case.md`, unique across the whole wiki (Obsidian resolves `[[slug]]` by file name, so `concepts/x.md` and `entities/x.md` collide)
- Entities: match official name where possible (e.g., `openai.md`, `gpt-4.md`)
- Concepts: descriptive noun phrases (e.g., `chain-of-thought.md`)
- Sources: the skill sets the source page path from the file name; link to it with the exact link the ingest step prints
- Queries: question as slug (e.g., `does-scale-improve-reasoning.md`)
- Meetings: `YYYY-MM-DD-slug.md` (e.g., `2024-03-15-sprint-planning.md`)
- Decisions: `NNN-slug.md` (e.g., `001-adopt-typescript.md`)
- Projects: descriptive slug (e.g., `payments-redesign.md`)
- Stakeholders: name or team in kebab-case (e.g., `alice-chen.md`, `platform-team.md`)

## Frontmatter

All pages:

```yaml
---
type: entity | concept | source | query | comparison | synthesis | overview | meeting | decision | project | stakeholder
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

Meeting pages also include:

```yaml
date: YYYY-MM-DD
attendees: []
action_items: []
```

Decision pages also include:

```yaml
status: proposed | accepted | deprecated | superseded
deciders: []
date: YYYY-MM-DD
supersedes: ""   # slug of ADR this replaces, if any
```

Project pages also include:

```yaml
status: planned | active | on-hold | complete | cancelled
owner: ""
start_date: YYYY-MM-DD
target_date: YYYY-MM-DD
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
- Meeting notes reference attendees via `attendees:` frontmatter and `[[stakeholder-slug]]` links
- Decision pages link to the meetings where the decision was discussed
- Project pages link to their key decisions via `related:`
- Stakeholder pages list projects and decisions they are involved in

## Contradiction Handling

When sources contradict each other:
1. Note the contradiction in the relevant concept or entity page, attributing each side to its source
2. Create or update a query page to track the open question
3. Link both sources from the query page
4. Resolve in a synthesis page once sufficient evidence exists

## Business-Specific Conventions

- Write meeting notes during or within 24 hours — memory fades fast
- Action items must have a named owner and due date to be actionable
- Decision pages capture *context and consequences*, not just the decision itself
- Deprecated decisions should link to the decision that superseded them
- Projects should have a retrospective section added on completion
