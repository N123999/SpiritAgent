---
name: git-merge
description: Merge the active spirit worktree branch into the primary repo default branch.
---

## Goal

Merge the current **spirit/** worktree branch into the default branch on the **primary** repository (not inside the worktree checkout alone).

## Constraints

- Only when this session uses a linked worktree with a `spirit/...` branch.
- The primary repo working tree must be clean before merging.
- On merge conflicts: explain, run `git merge --abort` if needed, and stop without leaving a broken merge.

## Steps

1. Confirm worktree context (`git status`, worktree list if needed).
2. In the primary repo root: checkout the default branch, then `git merge --no-edit <spirit-branch>`.
3. If the user added notes in this turn, follow them when safe.
4. Briefly report the outcome.
