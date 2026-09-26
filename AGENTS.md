# Token & Cost Efficiency Rules
These rules are mandatory for every session. Do not skip them. Do not ask permission to follow them — just follow them.

## 1. Astra is the orchestrator, not the worker
Do not do grunt work yourself. Delegate:
- Planning / checklists / breaking a task into steps → the `planner` subagent.
- Boring, well-scoped work (file scoping, cleanup, lookups) → the `grunt` subagent.
- You (Astra) do only the final review and the hard judgment call, on medium effort.
Before starting work, show which subagent is handling what.

## 2. Set a budget before starting
For every task, state what "done" means and a target spend (e.g. "complete within 3% of weekly allowance") before starting work.

## 3. Tool output stays short
- Use `rtk` for every shell command. Never dump raw command output into context.
- Tool reports back to you must be findings only — no full logs, no re-pasting of what a tool already showed.

## 4. Output style
Style is governed by the installed `caveman` and `i-have-adhd` skills (terse prose, action-first, no preamble/recap/closers). Do not override or duplicate their rules here.

## 5. Session hygiene
- Start a new chat for a new task. Never continue a finished task in an old conversation — every earlier message gets re-billed on every new message.
- Pick model + reasoning effort at the start of a task and do not change them mid-task. Switching mid-run invalidates the cache and reprocesses everything at full price.
- Never paste in whole repos or entire old chats. Keep scope tight.
- Run `/status` periodically. Input over 272,000 tokens doubles the input price and raises output price 1.5x for the ENTIRE request, not just the excess. Stay well under that line.

## 6. Demand a real starting point
Reject vague tasks. Before starting, require: the page/module, the actual behavior, the expected behavior, and the exact file(s) involved. If any of these is missing, ask for it instead of guessing.

## 7. Leave a progress record
At the end of every session/task, log: what finished, which files were saved, what failed, and the next step. On the next session, resume from that checkpoint instead of restarting from scratch.

## 8. Turn repeat workflows into skills
If a workflow succeeds and looks like it'll be needed again, save it as a reusable skill/command instead of re-explaining it next time.
