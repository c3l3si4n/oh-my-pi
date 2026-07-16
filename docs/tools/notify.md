# notify

> Send the user a push notification over Telegram, so an autonomous agent can reach them when they are away from the terminal (a long run finishing, a confirmed result, a blocking question). Delivered via the Telegram Bot API using a configured bot token and chat id.

## Source
- Entry: `packages/coding-agent/src/tools/notify.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/notify.md`

## Inputs

- `message` (string, required) — the notification text (plain text, truncated to Telegram's 4096-char limit).
- `silent` (boolean, optional, default `false`) — deliver without a sound/vibration (`disable_notification`).

## Output

Confirmation that the message was delivered, with the target chat id and Telegram message id in `details`.

## Configuration & gating

Registered only when `telegram.enabled` is set (Settings › Tools › Notifications › Telegram Notify). The bot token and target chat come from `telegram.botToken` and `telegram.chatId` — populate them in config; they are never supplied by the model, so no credential enters the transcript. Execution fails with a tool error when either is unset or the Telegram API rejects the send.
