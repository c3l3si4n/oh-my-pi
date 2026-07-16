Ask the advisor model (a second, independent model) for a one-shot second opinion.

Use this when an outside perspective genuinely changes what you do next:
- choosing between competing designs or approaches before committing significant work
- you are stuck: repeated failures, a bug that resists diagnosis, or a suspicion you are in a rabbit hole
- reviewing a risky change (data loss, migrations, security, concurrency) before applying it
- sanity-checking a conclusion you are about to act on but cannot verify cheaply

Do NOT call this for routine steps, questions you can answer by reading the code, or to confirm work that is already verified. Each call bills a full model request against the session; prefer at most one consult per decision.

`question` must be self-contained and specific — state the decision you face, the options you see, and what you already tried. Recent conversation history is attached automatically (disable with `include_history: false` when the question is independent of the session). Paste code, errors, or diffs the advisor must see into `context`; the advisor cannot read files or run commands.

The reply is advice from a model with no tools and no memory of prior consults — weigh it, verify load-bearing claims, and decide yourself.
