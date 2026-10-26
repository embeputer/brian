import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMessagesCommand } from "../src/cli/messages-command.ts";
import {
	type BeeperChat,
	BeeperClient,
	type BeeperMessage,
	loadBeeperConfig,
	saveBeeperConfig,
} from "../src/core/messaging/beeper.ts";
import {
	approveDraft,
	BRIAN_REPLY_PREFIX,
	type Decider,
	findChat,
	MessagingStore,
	ownerName,
	parseDecision,
	pollMessages,
	SENT_BY_BRIAN,
	sendAsBrian,
} from "../src/core/messaging/gateway.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "brian-messages-"));
	vi.stubEnv("BEEPER_ACCESS_TOKEN", "");
	vi.stubEnv("BEEPER_BASE_URL", "");
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

function chat(id: string, title: string, extra: Partial<BeeperChat> = {}): BeeperChat {
	return {
		id,
		accountID: "discord",
		network: "Discord",
		title,
		type: "single",
		unreadCount: 1,
		lastActivity: "2026-10-26T12:00:00Z",
		...extra,
	};
}

function msg(chatID: string, id: string, timestamp: string, text: string, isSender = false): BeeperMessage {
	return {
		id,
		chatID,
		accountID: "discord",
		senderID: isSender ? "me" : "alex",
		senderName: isSender ? undefined : "Alex",
		timestamp,
		sortKey: timestamp,
		text,
		type: "TEXT",
		isSender,
	};
}

function fakeBeeper(chats: BeeperChat[], messages: Record<string, BeeperMessage[]>) {
	const sent: Array<{ chatID: string; body: unknown }> = [];
	const requests: Array<{ url: string; auth: string | null }> = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		requests.push({ url: url.pathname, auth: new Headers(init?.headers).get("authorization") });
		const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
		if (url.pathname === "/v1/accounts") return json([{ accountID: "discord" }]);
		if (url.pathname === "/v1/chats") return json({ items: chats, hasMore: false });
		const match = url.pathname.match(/^\/v1\/chats\/([^/]+)\/messages$/);
		if (match && init?.method === "POST") {
			sent.push({ chatID: decodeURIComponent(match[1]), body: JSON.parse(String(init.body)) });
			return json({ chatID: match[1], pendingMessageID: "p1" });
		}
		if (match) return json({ items: [...(messages[decodeURIComponent(match[1])] ?? [])].reverse(), hasMore: false });
		if (url.pathname === "/v1/focus") return json({ success: true });
		return new Response("not found", { status: 404 });
	};
	return {
		client: new BeeperClient({ baseURL: "http://beeper.test", accessToken: "tok" }, fetchImpl),
		sent,
		requests,
	};
}

const since = "2026-10-26T11:00:00Z";
const now = new Date("2026-10-26T12:05:00Z");

describe("beeper config", () => {
	it("saves the token with mode 0600 and lets env override it", () => {
		const file = join(root, "beeper.json");
		saveBeeperConfig({ baseURL: "http://localhost:23373", accessToken: "saved" }, file);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(loadBeeperConfig(file)?.accessToken).toBe("saved");
		vi.stubEnv("BEEPER_ACCESS_TOKEN", "env");
		expect(loadBeeperConfig(file)?.accessToken).toBe("env");
	});
});

describe("parseDecision", () => {
	it("reads the last JSON line and rejects output without one", () => {
		expect(parseDecision('thinking...\n{"action":"reply","text":"yes, 5pm works","confident":true}')).toEqual({
			action: "reply",
			text: "yes, 5pm works",
			confident: true,
			reason: undefined,
		});
		expect(parseDecision('{"action":"skip","reason":"not for me"}').action).toBe("skip");
		expect(() => parseDecision("no json")).toThrow();
	});
});

describe("pollMessages", () => {
	function setup() {
		const store = new MessagingStore(join(root, "messaging.json"));
		store.setLastPoll(since);
		store.setIntro({ ownerName: "Sam" });
		return store;
	}

	it("drafts in draft mode, sends confident replies in auto mode, and skips ignored chats", async () => {
		const store = setup();
		const chats = [chat("c1", "Alex"), chat("c2", "App team"), chat("c3", "Muted", { isMuted: true })];
		const { client, sent, requests } = fakeBeeper(chats, {
			c1: [
				msg("c1", "m0", "2026-10-26T10:00:00Z", "hey"),
				msg("c1", "m1", "2026-10-26T11:30:00Z", "dinner tonight?"),
			],
			c2: [msg("c2", "m2", "2026-10-26T11:40:00Z", "is the build green?")],
			c3: [msg("c3", "m3", "2026-10-26T11:40:00Z", "spam")],
		});
		store.setPolicy({ chatID: "c2", title: "App team", mode: "auto", note: "only about the project" });
		const decide = vi.fn<Decider>(async (input) => ({
			action: "reply",
			text: input.chat.id === "c1" ? "can't tonight" : "yes, all green",
			confident: true,
		}));
		const result = await pollMessages(client, store, decide, now);
		expect(decide).toHaveBeenCalledTimes(2);
		expect(decide.mock.calls[0][0].history.map((m) => m.id)).toEqual(["m0"]);
		expect(decide.mock.calls[1][0].note).toBe("only about the project");
		expect(result.drafts.map((d) => [d.chatID, d.text])).toEqual([["c1", "can't tonight"]]);
		expect(sent).toEqual([
			{ chatID: "c2", body: { text: expect.stringMatching(/^hi, i'm brian, Sam's agent/) } },
			{ chatID: "c2", body: { text: `yes, all green${SENT_BY_BRIAN}`, replyToMessageID: "m2" } },
		]);
		expect(requests.every((r) => r.auth === "Bearer tok")).toBe(true);
		expect(store.read().lastPollAt).toBe(now.toISOString());
		expect(store.read().sent.map((s) => s.by)).toEqual(["auto", "auto"]);
	});

	it("drafts instead of sending when an auto reply isn't confident, and skips chats the user already answered", async () => {
		const store = setup();
		const { client, sent } = fakeBeeper([chat("c1", "Alex"), chat("c2", "Sam")], {
			c1: [msg("c1", "m1", "2026-10-26T11:30:00Z", "can you cover my shift friday?")],
			c2: [msg("c2", "m2", "2026-10-26T11:30:00Z", "lol"), msg("c2", "m3", "2026-10-26T11:31:00Z", "haha", true)],
		});
		store.setPolicy({ chatID: "c1", title: "Alex", mode: "auto" });
		const decide = vi.fn<Decider>(async () => ({
			action: "reply",
			text: "sure",
			confident: false,
			reason: "don't know schedule",
		}));
		const result = await pollMessages(client, store, decide, now);
		expect(decide).toHaveBeenCalledTimes(1);
		expect(sent).toEqual([]);
		expect(result.drafts[0].reason).toBe("don't know schedule");
	});

	it("treats the user's own messages in a brian chat as requests and never answers its own replies", async () => {
		const store = setup();
		const { client, sent } = fakeBeeper([chat("me", "Note to self")], {
			me: [
				msg("me", "m1", "2026-10-26T11:30:00Z", "remind me to call mom at 6", true),
				msg("me", "m2", "2026-10-26T11:31:00Z", `${BRIAN_REPLY_PREFIX}earlier answer`, true),
			],
		});
		store.setPolicy({ chatID: "me", title: "Note to self", mode: "brian" });
		const decide = vi.fn<Decider>(async () => ({ action: "reply", text: "set for 6pm" }));
		await pollMessages(client, store, decide, now);
		expect(decide.mock.calls[0][0].incoming.map((m) => m.id)).toEqual(["m1"]);
		expect(sent).toEqual([{ chatID: "me", body: { text: `${BRIAN_REPLY_PREFIX}set for 6pm` } }]);
	});

	it("records per-chat errors and keeps going", async () => {
		const store = setup();
		const { client } = fakeBeeper([chat("c1", "Alex"), chat("c2", "Sam")], {
			c1: [msg("c1", "m1", "2026-10-26T11:30:00Z", "hi")],
			c2: [msg("c2", "m2", "2026-10-26T11:30:00Z", "yo")],
		});
		const decide: Decider = async (input) => {
			if (input.chat.id === "c1") throw new Error("model down");
			return { action: "reply", text: "hey" };
		};
		const result = await pollMessages(client, store, decide, now);
		expect(result.errors).toEqual(["Alex: model down"]);
		expect(result.drafts).toHaveLength(1);
	});
});

describe("drafts", () => {
	it("approves with an edit, replaces older pending drafts, and refuses to send twice", async () => {
		const store = new MessagingStore(join(root, "messaging.json"));
		const { client, sent } = fakeBeeper([chat("c1", "Alex")], {});
		const base = {
			chatID: "c1",
			chatTitle: "Alex",
			network: "Discord",
			replyTo: "m1",
			from: "Alex",
			incoming: "dinner?",
		};
		const first = store.addDraft({ ...base, text: "sure" });
		const second = store.addDraft({ ...base, text: "can't tonight" });
		expect(store.getDraft(first.id)?.status).toBe("dismissed");
		await approveDraft(client, store, second.id, "can't tonight, tomorrow?");
		expect(sent.at(-1)).toEqual({
			chatID: "c1",
			body: { text: `can't tonight, tomorrow?${SENT_BY_BRIAN}`, replyToMessageID: "m1" },
		});
		await expect(approveDraft(client, store, second.id)).rejects.toThrow(/already sent/);
		expect(store.read().sent.map((s) => s.by)).toEqual(["approved", "approved"]);
	});
});

describe("marked as brian", () => {
	it("introduces itself once per chat, marks every message, and takes the name from the vault", async () => {
		const vault = join(root, "vault");
		mkdirSync(join(vault, "People"), { recursive: true });
		writeFileSync(join(vault, "People", "Samantha Lee.md"), "---\ntags: [me]\naliases: [Sam]\n---\nMy user.\n");
		const store = new MessagingStore(join(root, "messaging.json"));
		expect(ownerName(store, vault)).toBe("Sam");
		expect(ownerName(store, join(root, "missing"))).toBe("my user");
		const { client, sent } = fakeBeeper([chat("c1", "Alex")], {});
		await sendAsBrian(client, store, chat("c1", "Alex"), "on my way", { by: "manual", vaultDir: vault });
		await sendAsBrian(client, store, chat("c1", "Alex"), "5 min", { by: "manual", vaultDir: vault });
		expect(sent.map((s) => (s.body as { text: string }).text)).toEqual([
			expect.stringContaining("i'm brian, Sam's agent"),
			`on my way${SENT_BY_BRIAN}`,
			`5 min${SENT_BY_BRIAN}`,
		]);
		store.setIntro({ intro: "this is {name}'s brian" });
		await sendAsBrian(client, store, chat("c2", "Mom"), "hi", { by: "manual", vaultDir: vault });
		expect((sent.at(-2)?.body as { text: string }).text).toBe("this is Sam's brian");
	});

	it("send --as-me skips the intro and the mark", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const store = new MessagingStore(join(root, "messaging.json"));
		const { client, sent } = fakeBeeper([chat("c1", "Alex")], {});
		expect(await runMessagesCommand(["send", "Alex", "brb", "--as-me"], { store, client })).toBe(0);
		expect(sent).toEqual([{ chatID: "c1", body: { text: "brb" } }]);
		expect(store.read().introduced).toEqual([]);
	});
});

describe("findChat", () => {
	it("matches id, exact title, then a unique substring", () => {
		const chats = [chat("1", "App team"), chat("2", "App team design"), chat("3", "Mom")];
		expect(findChat(chats, "3").title).toBe("Mom");
		expect(findChat(chats, "app team").id).toBe("1");
		expect(findChat(chats, "mo").id).toBe("3");
		expect(() => findChat(chats, "app")).toThrow(/matches 2/);
		expect(() => findChat(chats, "zzz")).toThrow(/no chat/);
	});
});

describe("brian messages", () => {
	it("sets policies and lists drafts through the CLI", async () => {
		const store = new MessagingStore(join(root, "messaging.json"));
		const { client } = fakeBeeper([chat("c1", "App team")], {});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await runMessagesCommand(["policy", "app", "auto", "--note", "project only"], { store, client })).toBe(0);
		expect(store.read().policies.c1).toMatchObject({ mode: "auto", note: "project only" });
		expect(await runMessagesCommand(["policy", "--default", "ignore"], { store, client })).toBe(0);
		expect(store.read().defaultMode).toBe("ignore");
		expect(await runMessagesCommand(["drafts"], { store, client })).toBe(0);
		expect(log).toHaveBeenLastCalledWith("No drafts.");
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await runMessagesCommand(["policy", "app", "loud"], { store, client })).toBe(1);
	});

	it("tells the user to connect when Beeper isn't set up", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const store = new MessagingStore(join(root, "messaging.json"));
		expect(await runMessagesCommand(["chats"], { store, configFile: join(root, "none.json") })).toBe(1);
		expect(String(error.mock.calls[0][0])).toMatch(/connect beeper/);
	});

	it("connect verifies the token before saving it", async () => {
		const { client } = fakeBeeper([], {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		const configFile = join(root, "beeper.json");
		expect(await runMessagesCommand(["connect", "--token", "tok"], { client, configFile })).toBe(0);
		expect(loadBeeperConfig(configFile)?.accessToken).toBe("tok");
	});
});
