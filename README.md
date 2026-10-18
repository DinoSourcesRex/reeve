# Reeve

A Claude Code mod that puts your usage on one line under the prompt and keeps the rest in a side panel.

On a medieval manor the reeve was the man who kept an eye on the serfs. Here the serfs are your subagents, and the reeve also watches your context window and rate limits.

![The Reeve line and details panel](docs/screenshot.png)

## The line

```
🤖Opus 5.5 · serfs (2) │ ⚡18% · 36k/200k │ ⏱ 5h 23% · 2h 14m │ 📅wk 41% · 3d 6h │ 📁claudmods · 🌿main ✓ ↑1 · (PR#42) │ ▸ details
```

- Model, then how many subagents are running. The serf count sits in grey at zero and pulses orange while agents work.
- Context used, as a percentage and as tokens out of the window.
- The 5 hour and weekly rate limits, each with a countdown to its reset. At 75% they turn bold amber; at 90% they go bold red and get a ⚠.
- The current folder (click it to open Explorer), the git branch with a ✓ when the tree is clean, commits ahead and behind, and the open pull request as a link.
- `▸ details` opens the side panel.

When the terminal gets narrow, the countdowns drop off first, then the token counts. After that, long folder and branch names get shortened.

## The details panel

Click `▸ details` or run `/reeve` to open it on the right.

- Session shows the effort level, how long the session has run and what it has cost so far.
- Context has a gauge, a button that compacts the conversation, and a breakdown by category.
- Usage limits has a gauge for each window, with the countdown and the clock time of the reset.
- Workspace lists the folder, branch, last commit and pull request.
- Agents shows running agents first, then the most recent finished ones, five at a time. Each row has a spinner, an activity bar, its step count, context, output tokens and last tool. Finished agents show their runtime, finish time and the first line of their answer. Click a running agent to open its transcript, and `◂ back to main` to return.
- Loaded counts the hooks, MCP servers, mods and skills in the session. Click it for the full lists.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install reeve --marketplace DinoSourcesRex/reeve
```

Answer `y` to add the marketplace, then pick a scope. From a shell instead:

```
claude plugin install reeve --marketplace DinoSourcesRex/reeve
```

Reeve needs `git` on your path, and `gh` for the pull request link.

### Working on Reeve

To run your own clone with live reloading, point Claude Code at it with the `CLAUDE_CODE_PLUGIN_DIRS` environment variable and restart your terminal. As a user variable it applies to every Claude Code config folder, and saving a file reloads the mod. Uninstall the marketplace copy first, or Reeve loads twice.

```powershell
[Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', 'C:\path\to\reeve', 'User')
```

## Known limits

Claude Code draws its own subagents row in the footer, and mods cannot hide it, so running agents show up there as well as in the serf count.

The panel docks beside the transcript only in fullscreen mode at 110 columns or wider. Otherwise it opens above the prompt.

Opening the folder only works on Windows for now.
