# diff-lens

A mod for Claude Code Desktop. Click a file link in a reply and see **that file's changes against your base branch, scrolled to the line**.

When Claude walks you through a pull request or its own edits, its links normally open the plain file. With diff-lens, a link to a changed file opens a pane that shows the file with added and removed lines highlighted, unchanged stretches folded away, and the linked line marked and centred.

## Install

In a terminal session of Claude Code:

```
/plugin install diff-lens --marketplace mkiselyow/diff-lens
```

Answer `y` to add the marketplace and pick the user scope. The mod then loads in every session, including the ones the desktop app starts.

## Use

- **Click a link** to a changed file in any reply, for example `src/app.ts:47`. Links to unchanged files open the normal file view, as before.
- **`/diff-lens`** opens the pane with the list of changed files.
- **`/diff-lens src/app.ts:47`** opens one file at a line.
- **`/diff-lens base origin/release`** changes the branch to compare against.
- **`/diff-lens stats`** prints how long git, drawing and opening took in this session.

In the pane:

| Control | What it does |
|---|---|
| `▸ 12 files` | Show or hide the list of changed files; hover a file for its full path |
| `‹` `›` | Previous or next changed file |
| `↑` `↓` | Previous or next change in this file |
| `origin/main → working tree` | Choose another base branch |
| `▸ 34 unmodified lines` | Unfold that stretch |
| A line number | Put `path:line` into your prompt |

## What it compares

The working tree (committed and uncommitted changes, plus new untracked files) against the merge-base of `HEAD` and the base branch. That is what a pull request's "Files changed" shows, plus whatever is not committed yet.

The base is, in order: the `baseBranch` option, the remote's default branch, then the first of `origin/main`, `origin/master`, `origin/develop`, `origin/release`, `main`, `master` that exists. Change it any time from the pane or with `/diff-lens base <ref>`.

diff-lens only reads: it runs `git diff`, `git merge-base`, `git ls-files` and `git rev-parse`. It never fetches, switches branches or writes, and it makes no network calls.

## Limits

- **Desktop first.** Link clicks are handled on Claude Code Desktop only. In the terminal the pane and the commands work, without polish.
- **No syntax colours.** The mod API has no way to draw coloured code with per-line backgrounds, so code is drawn as plain text in the app's text font.
- **Renames show as a removed file and an added file.**
- **Very large diffs** draw the 400 lines around the changes or the linked line, and say how many were left out.
- **Early-access feature.** Mods are new: the API can change between Claude Code releases, and Anthropic turns the feature on per account. If the install succeeds but links and `/diff-lens` do nothing, mods are probably not enabled for your account yet. Tested with Claude Code 2.1.292 on macOS.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`hooks/diff.ts` (diff parsing and folding) and `hooks/links.ts` (link rewriting) are pure and unit-tested; `hooks/register.tsx` holds the hooks and the pane.

## License

MIT
