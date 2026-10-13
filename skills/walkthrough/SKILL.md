---
name: walkthrough
description: Guided walkthrough of a pull request, a branch or uncommitted changes, written so every step links to the exact changed line and diff-lens can show it. Use when asked to "guide me through", "walk me through", "explain", "help me understand" or "show me what changed in" a PR, a branch, these changes, or what an agent just did.
argument-hint: "[base branch, default: the repo's default branch such as origin/main]"
allowed-tools: mcp__diff-lens__compare, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git merge-base:*), Bash(git rev-parse:*), Read, Glob, Grep
---

# Walkthrough of a change set

The reader has the diff-lens pane: clicking a link to a changed file opens that file with its changes highlighted,
scrolled to the linked line. Write for that. Links carry the "what changed"; your text carries the "why".

## 1. Fix the change set

- Head is the working tree (committed and uncommitted work). Never switch branches, stash or reset.
- Base: the ref given as argument. With no argument, call the `mcp__diff-lens__compare` tool without a base: it
  answers with the default base the pane detected (the repository's default branch, usually `origin/main`). Use that,
  unless a pull request for this branch is known to target another branch; then use its target.
- Say which base you used in the first line, and that `/diff-lens:walkthrough <branch>` compares against another one.
- Call `mcp__diff-lens__compare` with the base you settled on, so the pane shows the same diff you read. If the tool
  is not available, ask the reader to type `/diff-lens base <ref>` into the prompt. It is a Claude Code command, not a
  shell command: write it as inline code, never in a fenced or runnable code block.
- Read the whole diff (`git diff $(git merge-base <base> HEAD)`) and the code around it before writing.

## 2. Write the walkthrough

- Open with one or two sentences: what the change does, how many files, and which step deserves the most attention.
- Order steps by how the data or control flows (source, mapping, rule, output, tests), not by file name.
- One numbered step per hop. Each step has:
  - a link to the first changed line of the hunk it explains, written `[File.ext:LINE](relative/path/File.ext:LINE)`,
    with LINE taken from the new file so it matches the pane;
  - what changed and why, in plain language, two to four sentences;
  - the test that proves it, linked the same way, or a plain statement that none does;
  - a verdict: fine, nit, or needs a change, with the reason.
- Link only lines that exist in the new file. For removed code, link the nearest surviving line and say what was removed.
- Do not paste large diffs; the pane shows them. A hunk of up to five lines is fine when the wording matters.
- State only what you verified. Label anything you did not check.

## 3. Close

End with "Where a change is needed": a ranked list, each item with its link and a proposed fix. If nothing needs a
change, say so in one line.
