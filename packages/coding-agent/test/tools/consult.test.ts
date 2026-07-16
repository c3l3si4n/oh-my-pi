import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, Context, Model, Usage } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { createTools } from "@oh-my-pi/pi-coding-agent/tools";
import { type ConsultCompleteImpl, ConsultTool } from "@oh-my-pi/pi-coding-agent/tools/consult";

Bun.env.PI_PYTHON_SKIP_CHECK = "1";

const advisorModel: Model<"openai-responses"> = buildModel({
	id: "gpt-advisor",
	name: "Advisor Test Model",
	api: "openai-responses",
	provider: "test-provider",
	baseUrl: "https://example.invalid/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
	contextWindow: 128000,
	maxTokens: 4096,
});

const stubUsage: Usage = {
	input: 120,
	output: 45,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 165,
	cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
};

interface CompleteStub {
	contexts: Context[];
	fn: ConsultCompleteImpl;
}

function createCompleteStub(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): CompleteStub {
	const contexts: Context[] = [];
	const fn: ConsultCompleteImpl = async (model, ctx) => {
		contexts.push(ctx);
		return {
			role: "assistant",
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: stubUsage,
			stopReason,
			timestamp: Date.now(),
			content: stopReason === "stop" ? [{ type: "text", text }] : [],
			errorMessage: stopReason === "error" ? "advisor provider exploded" : undefined,
		};
	};
	return { contexts, fn };
}

function createConsultSession(options: {
	availableModels?: Model<"openai-responses">[];
	settings?: Settings;
	messages?: AgentMessage[];
}): ToolSession {
	const settings = options.settings ?? Settings.isolated();
	const availableModels = options.availableModels ?? [advisorModel];
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getSessionId: () => "consult-test-session",
		getSessionMessages: () => options.messages ?? [],
		settings,
		modelRegistry: {
			getAvailable: () => availableModels,
			resolver: () => async () => "test-key",
		} as unknown as NonNullable<ToolSession["modelRegistry"]>,
	};
}

function sentUserText(ctx: Context | undefined): string {
	if (!ctx) return "";
	const parts: string[] = [];
	for (const message of ctx.messages) {
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			parts.push(message.content);
			continue;
		}
		for (const part of message.content) {
			if (part.type === "text") parts.push(part.text);
		}
	}
	return parts.join("\n");
}

function advisorSettings(): Settings {
	const settings = Settings.isolated();
	settings.setModelRole("advisor", `${advisorModel.provider}/${advisorModel.id}`);
	return settings;
}

function sampleHistory(): AgentMessage[] {
	return [
		{ role: "user", content: [{ type: "text", text: "please refactor the auth module" }], timestamp: 1 },
		{
			role: "assistant",
			api: advisorModel.api,
			provider: advisorModel.provider,
			model: advisorModel.id,
			usage: stubUsage,
			stopReason: "stop",
			timestamp: 2,
			content: [{ type: "text", text: "I plan to split it into three files." }],
		},
	] as AgentMessage[];
}

describe("ConsultTool", () => {
	it("sends transcript excerpt + context + question and bills usage on details", async () => {
		const stub = createCompleteStub("Split by responsibility, not by file size.");
		const session = createConsultSession({ settings: advisorSettings(), messages: sampleHistory() });
		const tool = new ConsultTool(session, { completeImpl: stub.fn });

		const result = await tool.execute("call-1", {
			question: "Is a three-file split the right shape?",
			context: "current file is 900 lines",
		});

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("Split by responsibility");
		expect(result.details?.model).toBe(`${advisorModel.provider}/${advisorModel.id}`);
		expect(result.details?.usage).toEqual(stubUsage);
		expect(result.details?.historyIncluded).toBe(true);

		expect(stub.contexts).toHaveLength(1);
		const sent = stub.contexts[0];
		const sentText = sentUserText(sent);
		expect(sentText).toContain("## Recent session transcript");
		expect(sentText).toContain("please refactor the auth module");
		expect(sentText).toContain("## Context supplied by the agent");
		expect(sentText).toContain("current file is 900 lines");
		expect(sentText).toContain("## Question");
		expect(sentText).toContain("Is a three-file split the right shape?");
		expect(sent?.systemPrompt?.join("\n")).toContain("consulting engineer");
	});

	it("omits the transcript when include_history is false", async () => {
		const stub = createCompleteStub("Looks fine.");
		const session = createConsultSession({ settings: advisorSettings(), messages: sampleHistory() });
		const tool = new ConsultTool(session, { completeImpl: stub.fn });

		const result = await tool.execute("call-2", { question: "Standalone question?", include_history: false });

		expect(result.details?.historyIncluded).toBe(false);
		const sentText = sentUserText(stub.contexts[0]);
		expect(sentText).not.toContain("## Recent session transcript");
		expect(sentText).toContain("Standalone question?");
	});

	it("throws a ToolError when no advisor model resolves", async () => {
		const stub = createCompleteStub("unused");
		const session = createConsultSession({ availableModels: [], messages: [] });
		const tool = new ConsultTool(session, { completeImpl: stub.fn });

		await expect(tool.execute("call-3", { question: "anyone there?" })).rejects.toThrow(
			/could not resolve an advisor model/,
		);
		expect(stub.contexts).toHaveLength(0);
	});

	it("surfaces provider errors as ToolErrors", async () => {
		const stub = createCompleteStub("", "error");
		const session = createConsultSession({ settings: advisorSettings(), messages: [] });
		const tool = new ConsultTool(session, { completeImpl: stub.fn });

		await expect(tool.execute("call-4", { question: "does this blow up?" })).rejects.toThrow(
			/advisor provider exploded/,
		);
	});
});

describe("createTools consult gating", () => {
	it("excludes consult by default and includes it when advisor.toolEnabled is set", async () => {
		const disabled = await createTools(createConsultSession({ settings: Settings.isolated() }), ["read", "consult"]);
		expect(disabled.map(t => t.name)).not.toContain("consult");

		const enabled = await createTools(
			createConsultSession({ settings: Settings.isolated({ "advisor.toolEnabled": true }) }),
			["read", "consult"],
		);
		expect(enabled.map(t => t.name)).toContain("consult");
	});
});
