# Memory Vault

Brian keeps long-term memory in a folder of plain markdown files at `~/.brian/memory` (override with `BRIAN_MEMORY_DIR`). Each memory is one file and the file name is the memory's name. Nothing is hidden in a database, so other agents, editors, and Obsidian can read and write the same vault.

```
~/.brian/memory/
  README.md
  People/
    Alex Kim.md
  Agent/
    Personality.md
  School/
    Calculus finals.md
  Work/
    Acme/
      Standup.md
```

- `People/` holds one note per person: full name as the file name, nicknames as `aliases`, plus occupation, email, phone, and a description.
- `Agent/` holds Brian's own notes: personality, voice, and how you want it to act. Every `Agent/` note is loaded into Brian's system prompt (up to 8,000 characters).
- Brian creates other folders as it needs them (Work, School, Life, Relationships, ...).

## Note format

```markdown
---
tags: [school, exams]
people: [Alex Kim]
---
Study group on Thursdays. Exam is May 12.
```

`tags` are topics (lowercased, a leading `#` is dropped). `people` links the memory to people by full name. A `[[Full Name]]` link in the body also counts as a person link.

## CLI

```bash
brian memory search exams --folder School --person "Alex Kim"   # prints matching file paths
brian memory search --tag friend --long                         # paths plus tags and a snippet
brian memory search alex --json                                 # machine-readable results
brian memory add People/"Alex Kim" -t friend -c "Nickname: AK"  # create a note (or pipe the body on stdin)
brian memory add School/"Calculus finals" --mode append -c "Exam is May 12."
brian memory show "Calculus finals"
brian memory list --folder Work
brian memory folders
brian memory path
```

Every filter must match. Text is split into words, and each word must appear in the note's name, tags, people, aliases, or body. `search` exits with status 1 when nothing matches, so scripts and other agents can branch on it.

## Tools

Brian gets two built-in tools:

- `memory_search`: the same search as the CLI. Returns file paths, tags, people, and a snippet.
- `memory_write`: create, append to, or replace `<folder>/<name>.md`. It appends by default if the note exists. Tags and people merge into the frontmatter.

Brian is told to search memory before answering personal questions and to save durable facts as it learns them. It never stores secrets in the vault.
