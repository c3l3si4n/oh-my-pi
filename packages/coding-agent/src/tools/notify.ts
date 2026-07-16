/**
 * Telegram push notification.
 *
 * Lets the agent notify the user out-of-band — a long autonomous run finishing,
 * a confirmed finding, a question that blocks progress — by posting to a
 * Telegram chat via the Bot API. The bot token and default chat id come from
 * settings (`telegram.botToken` / `telegram.chatId`), never from the model or
 * the prompt, so a credential is never placed in the transcript.
 */
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { FetchImpl } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import { type } from "arktype";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import notifyDescription from "../prompts/tools/notify.md" with { type: "text" };
import { framedBlock, renderStatusLine, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import { formatErrorDetail, TRUNCATE_LENGTHS } from "./render-utils";
import { ToolError } from "./tool-errors";

const notifySchema = type({
	message: type("string>0").describe("the notification text to send to the user"),
	"silent?": type("boolean").describe("deliver without a sound/vibration (default false)"),
});

export type NotifyToolInput = typeof notifySchema.infer;

export interface NotifyToolDetails {
	/** Telegram chat the message was delivered to. */
	chatId: string;
	/** Telegram message id on success. */
	messageId?: number;
	/** Whether the notification was silent. */
	silent: boolean;
}

/** Telegram hard cap on a single message body. */
const TELEGRAM_TEXT_MAX = 4096;
/** Wall-clock cap on the delivery request. */
const REQUEST_TIMEOUT_MS = 15_000;

interface TelegramResponse {
	ok: boolean;
	description?: string;
	error_code?: number;
	result?: { message_id?: number };
}

export class NotifyTool implements AgentTool<typeof notifySchema, NotifyToolDetails> {
	readonly name = "notify";
	readonly label = "Notify";
	readonly description = prompt.render(notifyDescription);
	readonly parameters = notifySchema;
	readonly strict = true;
	readonly intent = "omit" as const;
	// Top-level (not mounted under xd://): the agent is asked to notify on every
	// substantial update, so the tool must stay directly visible in the schema.
	readonly loadMode = "essential";
	readonly #session: ToolSession;

	constructor(session: ToolSession) {
		this.#session = session;
	}

	async execute(
		_toolCallId: string,
		params: NotifyToolInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<NotifyToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<NotifyToolDetails>> {
		const text = params.message.trim();
		if (!text) {
			throw new ToolError("message must not be empty");
		}
		const token = this.#session.settings.get("telegram.botToken")?.trim();
		if (!token) {
			throw new ToolError("notify is unconfigured: set telegram.botToken in config.");
		}
		const chatId = this.#session.settings.get("telegram.chatId")?.trim();
		if (!chatId) {
			throw new ToolError("notify is unconfigured: set telegram.chatId (the target chat/channel) in config.");
		}
		const silent = params.silent === true;

		const doFetch: FetchImpl = this.#session.fetch ?? fetch;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		const onAbort = () => controller.abort();
		signal?.addEventListener("abort", onAbort, { once: true });

		let payload: TelegramResponse;
		try {
			const response = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					text: text.slice(0, TELEGRAM_TEXT_MAX),
					disable_notification: silent,
				}),
				signal: controller.signal,
			});
			payload = (await response.json()) as TelegramResponse;
		} catch (error) {
			const reason = controller.signal.aborted ? "request timed out or was aborted" : String(error);
			throw new ToolError(`notify: Telegram request failed (${reason}).`);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}

		if (!payload.ok) {
			// Telegram echoes the failing chat id / permission problem in `description`;
			// the bot token is never part of the response, so this is safe to surface.
			throw new ToolError(`notify: Telegram rejected the message (${payload.error_code}: ${payload.description}).`);
		}

		return {
			content: [{ type: "text", text: `Notification delivered to ${chatId}.` }],
			details: { chatId, messageId: payload.result?.message_id, silent },
		};
	}
}

interface NotifyRenderArgs {
	message?: string;
	silent?: boolean;
}

export const notifyToolRenderer = {
	renderCall(args: NotifyRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const meta: string[] = [];
		const trimmed = args.message?.trim();
		if (trimmed) {
			meta.push(uiTheme.italic(uiTheme.fg("muted", `"${truncateToWidth(trimmed, TRUNCATE_LENGTHS.TITLE)}"`)));
		}
		return new Text(renderStatusLine({ icon: "pending", title: "Notify", meta }, uiTheme), 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: NotifyToolDetails; isError?: boolean },
		_options: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const text = result.content?.find(c => c.type === "text")?.text ?? "";
		if (result.isError) {
			const header = renderStatusLine({ icon: "error", title: "Notify" }, uiTheme);
			return framedBlock(uiTheme, width => ({
				header,
				sections: [{ lines: formatErrorDetail(text || "notify failed", uiTheme).split("\n") }],
				state: "error",
				borderColor: "error",
				width,
			}));
		}
		return new Text(
			renderStatusLine(
				{ icon: "success", title: "Notify", description: result.details?.chatId, meta: ["sent"] },
				uiTheme,
			),
			0,
			0,
		);
	},

	mergeCallAndResult: true,
};
