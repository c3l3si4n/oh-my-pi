Starts a persistent worker session that you drive by conversation. Pick the CLI flavor per task:

- `scout`: cheap read-only recon (`read`/`grep`/`glob`/`web_search`, no edit/run). Breadth-first enumeration that returns a compressed candidate list — map a surface, catalog call sites/routes/sinks, sweep for a pattern. Spawn many in parallel; a scout answers in one pass, so collect and `vibe_kill` rather than continuing the conversation.
- `fast`: cheap model, full tools, for mechanical hands-on work (renames, boilerplate, running tests, data collection).
- `build`: plans on the strong model, then hands off to the cheap model at its first edit for the mechanical build-out. For plan-heavy, edit-heavy work — harnesses, PoC scaffolds, instrumentation — where the design needs judgment but the typing is mechanical.
- `good`: strong model throughout, full tools, for the judgment tier (confirmation, debugging, severity calls) where the hard reasoning continues past the first edit.

`scout`/`fast` are ~5× cheaper per token than `good`, and `build` pays the strong rate only for its planning head; route breadth and grind to them, reserve `good` for the calls that decide the outcome.

`prompt` is the session's first instruction. The worker starts with NO context beyond it — include files, constraints, and acceptance criteria. `name` (optional) labels the session; otherwise one is generated.

Returns immediately with the session id; the turn's result (activity trace + the worker's response) is delivered to you automatically when the worker finishes. Do not wait unless you are blocked — keep directing other sessions.

The session persists after the turn: it remembers the whole conversation. Continue it with `vibe_send`; never spawn a second session for a follow-up on the same workstream.
