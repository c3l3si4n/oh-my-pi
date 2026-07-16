import { describe, expect, it } from "bun:test";
import type { FetchImpl } from "@oh-my-pi/pi-ai";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { createTools } from "@oh-my-pi/pi-coding-agent/tools";
import { NotifyTool } from "@oh-my-pi/pi-coding-agent/tools/notify";

Bun.env.PI_PYTHON_SKIP_CHECK = "1";

interface FetchStub {
	calls: Array<{ url: string; body: unknown }>;
	fetch: FetchImpl;
}

function createFetchStub(response: unknown, ok = true): FetchStub {
	const calls: Array<{ url: string; body: unknown }> = [];
	const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return {
			ok,
			status: ok ? 200 : 400,
			json: async () => response,
		} as unknown as Response;
	}) as unknown as FetchImpl;
	return { calls, fetch };
}

function createNotifySession(overrides: Record<string, unknown>, fetch?: FetchImpl): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(overrides),
		fetch,
	} as unknown as ToolSession;
}

describe("NotifyTool", () => {
	it("posts the message to the configured chat via the bot token", async () => {
		const stub = createFetchStub({ ok: true, result: { message_id: 42 } });
		const session = createNotifySession(
			{ "telegram.botToken": "BOT:TOKEN", "telegram.chatId": "-100123" },
			stub.fetch,
		);
		const tool = new NotifyTool(session);

		const result = await tool.execute("call-1", { message: "hunt finished: 2 criticals" });

		expect(result.details?.messageId).toBe(42);
		expect(result.details?.chatId).toBe("-100123");
		expect(result.details?.silent).toBe(false);
		expect(stub.calls).toHaveLength(1);
		expect(stub.calls[0]?.url).toBe("https://api.telegram.org/botBOT:TOKEN/sendMessage");
		expect(stub.calls[0]?.body).toMatchObject({
			chat_id: "-100123",
			text: "hunt finished: 2 criticals",
			disable_notification: false,
		});
	});

	it("passes silent through as disable_notification", async () => {
		const stub = createFetchStub({ ok: true, result: { message_id: 7 } });
		const session = createNotifySession({ "telegram.botToken": "T", "telegram.chatId": "5" }, stub.fetch);
		await new NotifyTool(session).execute("c", { message: "fyi", silent: true });
		expect(stub.calls[0]?.body).toMatchObject({ disable_notification: true });
	});

	it("errors when the bot token is unconfigured", async () => {
		const session = createNotifySession({ "telegram.chatId": "5" });
		await expect(new NotifyTool(session).execute("c", { message: "hi" })).rejects.toThrow(/telegram\.botToken/);
	});

	it("errors when the chat id is unconfigured", async () => {
		const session = createNotifySession({ "telegram.botToken": "T" });
		await expect(new NotifyTool(session).execute("c", { message: "hi" })).rejects.toThrow(/telegram\.chatId/);
	});

	it("surfaces a Telegram API rejection as a ToolError", async () => {
		const stub = createFetchStub({ ok: false, error_code: 400, description: "chat not found" }, false);
		const session = createNotifySession({ "telegram.botToken": "T", "telegram.chatId": "bad" }, stub.fetch);
		await expect(new NotifyTool(session).execute("c", { message: "hi" })).rejects.toThrow(/chat not found/);
	});
});

describe("createTools notify gating", () => {
	it("excludes notify by default and includes it when telegram.enabled is set", async () => {
		const disabled = await createTools(createNotifySession({}), ["read", "notify"]);
		expect(disabled.map(t => t.name)).not.toContain("notify");

		const enabled = await createTools(createNotifySession({ "telegram.enabled": true }), ["read", "notify"]);
		expect(enabled.map(t => t.name)).toContain("notify");
	});
});
