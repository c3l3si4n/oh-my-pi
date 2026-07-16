Send the user a push notification over Telegram.

Use this to reach the user out-of-band when they are away from the terminal and something warrants their attention:
- a long autonomous run (a hunt, a build, a migration) has finished or hit a milestone
- a confirmed result worth surfacing immediately
- you are blocked on a decision or credential and cannot make progress without them

Keep it to genuine updates — this pings the user's phone. Do NOT narrate routine progress, and do NOT use it in place of your normal response in the terminal. One clear message per event.

`message` is the notification text (plain text, up to 4096 characters). Set `silent: true` for a low-priority heads-up that arrives without a sound.

The target chat and bot credential come from configuration (`telegram.chatId` / `telegram.botToken`); you do not supply them. If notifications are unconfigured the call returns an error — surface that to the user rather than retrying.
