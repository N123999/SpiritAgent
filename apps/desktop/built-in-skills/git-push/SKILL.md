---
name: git-push
description: Push the current branch to its configured remote.
---

## Goal

Push the current branch to the configured upstream remote for this workspace.

## Steps

1. Run `git status -sb` to see branch and ahead/behind state.
2. If there is nothing to push, say so and stop.
3. Run `git push` (use `-u` only when upstream is missing and appropriate).
4. If the user added notes in this turn, follow them when safe.
5. Briefly report the outcome.
