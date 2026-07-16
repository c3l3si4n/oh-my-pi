Send the user a push notification over Telegram. The user is away from the terminal and relies on these messages to follow the run, so notify PROACTIVELY — at every substantial update, not only when you finish or get stuck.

Send a notification whenever something the user would want to know just happened, including:
- a milestone reached or a phase completed (surface mapped, harness built, a workstream done)
- a finding confirmed OR ruled out, a hypothesis validated or killed, a meaningful intermediate result
- a change of direction or strategy, or a decision that shapes the rest of the run
- a run, build, or long task finishing
- you are blocked and need a decision, a credential, or input to continue

Err toward sending. A steady stream of substantial updates is the goal; the user asked to be kept in the loop, not just pinged at the end. Only skip genuinely trivial micro-steps (a single file read, one routine command) — batch those into the next real update rather than narrating each one.

Each notification stands alone: the user reads it on their phone with no terminal context, so make it self-contained — what happened and why it matters, in a sentence or two. This does not replace your normal terminal response; it is an additional out-of-band ping. Use `silent: true` for lower-priority progress updates so only important ones buzz.

`message` is the notification text (plain text, up to 4096 characters). The target chat and bot credential come from configuration (`telegram.chatId` / `telegram.botToken`); you do not supply them. If notifications are unconfigured the call returns an error — surface it to the user rather than retrying.
