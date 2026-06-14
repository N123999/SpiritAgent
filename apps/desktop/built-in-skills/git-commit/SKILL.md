---
name: git-commit
description: Commit current workspace changes using repository conventions.
---

## Goal

Create one local Git commit for the active workspace.

## Steps

1. Run `git status` and `git diff` (or `git diff HEAD`) to inspect changes.
2. If there is nothing to commit, say so and stop.
3. Infer the commit message from **this repository** (recent `git log`, `CONTRIBUTING*`, `.github/`, `AGENTS.md`, copilot instructions, etc.). Do not assume a fixed language or Conventional Commits layout unless the repo shows it.
4. If the user added notes in this turn, apply them when they fit repo conventions.
5. Stage and commit with `git add` and `git commit` via the shell tool in this session.
6. Briefly report the outcome (hash or summary).
