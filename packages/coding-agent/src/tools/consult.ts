/**
 * On-demand advisor consultation.
 *
 * Unlike the passive `/advisor` runtime — which shadows every primary turn —
 * `consult` lets the primary model pull a one-shot second opinion from the
 * advisor-role model exactly when it judges one is worth the spend. The call
 * is stateless and toolless: question (+ optional pasted context + a bounded
 * recent-transcript excerpt) in, advice text out. Response usage is placed on
 * `details.usage` so `getSessionStats()` bills it to the session like `task`
 * subagent spend (and, transitively, to an active goal budget).
 */
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { instrumentedCompleteSimple, resolveTelemetry, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, Usage } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import { type } from "arktype";
import { formatModelString, resolveAdvisorRoleSelection } from "../config/model-resolver";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import consultSystemPrompt from "../prompts/advisor/consult-system.md" with { type: "text" };
import consultDescription from "../prompts/tools/consult.md" with { type: "text" };
import { formatSessionHistoryMarkdown } from "../session/session-history-format";
import { concreteThinkingLevel, resolveThinkingLevelForModel, toReasoningEffort } from "../thinking";
import { framedBlock, renderStatusLine, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import { formatErrorDetail, TRUNCATE_LENGTHS } from "./render-utils";
import { ToolError } from "./tool-errors";

const consultSchema = type({
	question: type("string>0").describe("self-contained question for the advisor"),
	"context?": type("string").describe("code, errors, or diffs the advisor must see"),
	"include_history?": type("boolean").describe("attach recent session transcript (default true)"),
});

export type ConsultToolInput = typeof consultSchema.infer;

export interface ConsultToolDetails {
	/** Resolved advisor model in provider/id form. */
	model: string;
	/** Provider-reported usage for the consultation; billed into session stats. */
	usage?: Usage;
	/** Whether a transcript excerpt accompanied the question. */
	historyIncluded: boolean;
}

/** Newest transcript messages considered for the excerpt. */
const MAX_HISTORY_MESSAGES = 40;
/** Rendered-excerpt cap; older lines are dropped first. */
const MAX_HISTORY_CHARS = 20_000;

/** Injection seam matching {@link instrumentedCompleteSimple}'s `completeImpl`. */
export type ConsultCompleteImpl = <TApi extends Api>(
	model: Model<TApi>,
	ctx: Context,
	options: SimpleStreamOptions,
) => Promise<AssistantMessage>;

/**
 * Render the newest session messages as a markdown excerpt bounded by
 * {@link MAX_HISTORY_CHARS}. Thinking blocks and edit diffs stay elided —
 * the caller pastes anything load-bearing into `context` instead.
 */
function renderHistoryExcerpt(messages: unknown[]): string {
	if (messages.length === 0) return "";
	const tail = messages.slice(-MAX_HISTORY_MESSAGES);
	const rendered = formatSessionHistoryMarkdown(tail, { watchedRoles: true, includeToolIntent: true });
	if (rendered.length <= MAX_HISTORY_CHARS) return rendered;
	return `…[earlier transcript truncated]\n${rendered.slice(rendered.length - MAX_HISTORY_CHARS)}`;
}

export class ConsultTool implements AgentTool<typeof consultSchema, ConsultToolDetails> {
	readonly name = "consult";
	readonly label = "Consult";
	readonly description = prompt.render(consultDescription);
	readonly parameters = consultSchema;
	readonly strict = true;
	readonly intent = "omit" as const;
	readonly loadMode = "discoverable";
	readonly #session: ToolSession;
	readonly #completeImpl?: ConsultCompleteImpl;

	constructor(session: ToolSession, options?: { completeImpl?: ConsultCompleteImpl }) {
		this.#session = session;
		this.#completeImpl = options?.completeImpl;
	}

	async execute(
		_toolCallId: string,
		params: ConsultToolInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ConsultToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ConsultToolDetails>> {
		const question = params.question.trim();
		if (!question) {
			throw new ToolError("question must not be empty");
		}
		const registry = this.#session.modelRegistry;
		if (!registry) {
			throw new ToolError("consult is unavailable: no model registry in this session.");
		}
		const selection = resolveAdvisorRoleSelection(this.#session.settings, registry.getAvailable());
		if (!selection) {
			throw new ToolError(
				"consult could not resolve an advisor model. Configure modelRoles.advisor or authenticate a provider for the advisor priority chain.",
			);
		}
		const { model } = selection;
		const sessionId = this.#session.getSessionId?.() ?? undefined;

		const includeHistory = params.include_history !== false;
		const historyMessages = includeHistory ? (this.#session.getSessionMessages?.() ?? []) : [];
		const historyExcerpt = renderHistoryExcerpt(historyMessages);

		const sections: string[] = [];
		if (historyExcerpt) {
			sections.push(`## Recent session transcript\n\n${historyExcerpt}`);
		}
		const pastedContext = params.context?.trim();
		if (pastedContext) {
			sections.push(`## Context supplied by the agent\n\n${pastedContext}`);
		}
		sections.push(`## Question\n\n${question}`);

		const configuredLevel = concreteThinkingLevel(selection.thinkingLevel);
		const resolvedLevel = resolveThinkingLevelForModel(model, configuredLevel ?? ThinkingLevel.Medium);
		const reasoning = toReasoningEffort(resolvedLevel);

		const telemetry = resolveTelemetry(this.#session.getTelemetry?.(), sessionId);
		const response = await instrumentedCompleteSimple(
			model,
			{
				systemPrompt: [prompt.render(consultSystemPrompt)],
				messages: [
					{ role: "user", content: [{ type: "text", text: sections.join("\n\n") }], timestamp: Date.now() },
				],
			},
			{
				apiKey: registry.resolver(model, sessionId),
				signal,
				reasoning,
			},
			{ telemetry, oneshotKind: "consult", completeImpl: this.#completeImpl },
		);

		if (response.stopReason === "error") {
			throw new ToolError(response.errorMessage ?? "consult request failed.");
		}
		if (response.stopReason === "aborted") {
			throw new ToolError("consult request aborted.");
		}
		const advice = response.content
			.filter(part => part.type === "text")
			.map(part => part.text)
			.join("\n")
			.trim();
		if (!advice) {
			throw new ToolError("consult returned no text output.");
		}

		return {
			content: [{ type: "text", text: advice }],
			details: {
				model: formatModelString(model),
				usage: response.usage,
				historyIncluded: historyExcerpt.length > 0,
			},
		};
	}
}

interface ConsultRenderArgs {
	question?: string;
	include_history?: boolean;
}

export const consultToolRenderer = {
	renderCall(args: ConsultRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const meta: string[] = [];
		const trimmedQuestion = args.question?.trim();
		if (trimmedQuestion) {
			meta.push(
				uiTheme.italic(uiTheme.fg("muted", `"${truncateToWidth(trimmedQuestion, TRUNCATE_LENGTHS.TITLE)}"`)),
			);
		}
		return new Text(renderStatusLine({ icon: "pending", title: "Consult", meta }, uiTheme), 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: ConsultToolDetails; isError?: boolean },
		_options: RenderResultOptions,
		uiTheme: Theme,
		args?: ConsultRenderArgs,
	): Component {
		const text = result.content?.find(c => c.type === "text")?.text ?? "";
		const modelLabel = result.details?.model;

		if (result.isError) {
			const header = renderStatusLine({ icon: "error", title: "Consult" }, uiTheme);
			return framedBlock(uiTheme, width => ({
				header,
				sections: [{ lines: formatErrorDetail(text || "consult failed", uiTheme).split("\n") }],
				state: "error",
				borderColor: "error",
				width,
			}));
		}

		const header = renderStatusLine({ icon: "success", title: "Consult", description: modelLabel }, uiTheme);
		const lines: string[] = [];
		const trimmedQuestion = args?.question?.trim();
		if (trimmedQuestion) {
			lines.push(
				uiTheme.italic(uiTheme.fg("muted", `"${truncateToWidth(trimmedQuestion, TRUNCATE_LENGTHS.LONG)}"`)),
			);
			lines.push("");
		}
		lines.push(...text.split("\n"));
		return framedBlock(uiTheme, width => ({
			header,
			sections: [{ lines }],
			state: "success",
			borderColor: "borderMuted",
			width,
		}));
	},

	mergeCallAndResult: true,
};
