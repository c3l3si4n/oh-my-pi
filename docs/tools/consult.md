# consult

> On-demand one-shot second opinion from the advisor-role model. Unlike the passive `/advisor` runtime (which shadows every primary turn), the primary model calls `consult` only when it judges an outside perspective is worth the spend. Stateless and toolless: question + optional pasted context + a bounded recent-transcript excerpt in, advice text out.

## Source
- Entry: `packages/coding-agent/src/tools/consult.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/consult.md`
- Consultant system prompt: `packages/coding-agent/src/prompts/advisor/consult-system.md`
- Key collaborators:
  - `packages/coding-agent/src/config/model-resolver.ts` — `resolveAdvisorRoleSelection` picks the model (`modelRoles.advisor`, else the `slow` priority chain; never inherits the primary's model).
  - `packages/coding-agent/src/session/session-history-format.ts` — `formatSessionHistoryMarkdown` renders the transcript excerpt (thinking and edit diffs elided).
  - `@oh-my-pi/pi-agent-core` `instrumentedCompleteSimple` — one-shot completion with chat-span telemetry (`oneshotKind: "consult"`).
  - `packages/coding-agent/src/session/agent-session.ts` — `getSessionStats()` bills `details.usage` like `task` subagent spend (so consult spend also counts toward an active goal budget).

## Inputs

- `question` (string, required) — self-contained question for the advisor.
- `context` (string, optional) — code, errors, or diffs the advisor must see; the advisor has no tools and cannot read files.
- `include_history` (boolean, optional, default `true`) — attach an excerpt of the newest session messages (last 40 messages, capped at 20k rendered characters, oldest lines dropped first).

## Output

The advisor's advice as plain text. `details` carries `{ model, usage, historyIncluded }`; `usage` is the provider-reported usage for the consultation.

## Gating

Registered only when `advisor.toolEnabled` is set (Settings › Model › Advisor › Consult Tool). Independent of `advisor.enabled` — either, both, or neither may be on. Execution fails with a tool error when no advisor model resolves or the provider request errors.
