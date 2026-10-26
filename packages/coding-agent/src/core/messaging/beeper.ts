import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";

/** Beeper Desktop's local API. Enable it in Beeper Desktop under Settings -> Integrations. */
export const DEFAULT_BEEPER_URL = "http://localhost:23373";

export interface BeeperConfig {
	baseURL: string;
	accessToken: string;
}

export interface BeeperAccount {
	accountID: string;
	network?: string;
	user?: { fullName?: string; username?: string };
}

export interface BeeperChat {
	id: string;
	accountID: string;
	network: string;
	title: string;
	type: "single" | "group";
	unreadCount: number;
	isMuted?: boolean;
	isArchived?: boolean;
	isLowPriority?: boolean;
	lastActivity?: string;
}

export interface BeeperMessage {
	id: string;
	chatID: string;
	accountID: string;
	senderID: string;
	senderName?: string;
	timestamp: string;
	sortKey: string;
	text?: string;
	type?: string;
	isSender?: boolean;
}

export interface BeeperPage<T> {
	items: T[];
	hasMore: boolean;
}

export function getBeeperConfigPath(): string {
	return join(getAgentDir(), "beeper.json");
}

/** BEEPER_ACCESS_TOKEN / BEEPER_BASE_URL override the saved connection. */
export function loadBeeperConfig(file: string = getBeeperConfigPath()): BeeperConfig | undefined {
	let saved: Partial<BeeperConfig> = {};
	if (existsSync(file)) saved = JSON.parse(readFileSync(file, "utf8")) as Partial<BeeperConfig>;
	const accessToken = process.env.BEEPER_ACCESS_TOKEN || saved.accessToken;
	if (!accessToken) return undefined;
	return { accessToken, baseURL: process.env.BEEPER_BASE_URL || saved.baseURL || DEFAULT_BEEPER_URL };
}

export function saveBeeperConfig(config: BeeperConfig, file: string = getBeeperConfigPath()): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	chmodSync(file, 0o600);
}

export class BeeperError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export class BeeperClient {
	readonly baseURL: string;
	private readonly accessToken: string;
	private readonly fetchImpl: typeof fetch;

	constructor(config: BeeperConfig, fetchImpl: typeof fetch = fetch) {
		this.baseURL = config.baseURL.replace(/\/+$/, "");
		this.accessToken = config.accessToken;
		this.fetchImpl = fetchImpl;
	}

	private async request<T>(
		method: string,
		path: string,
		query?: Record<string, string | number | undefined>,
		body?: unknown,
	): Promise<T> {
		const url = new URL(`${this.baseURL}${path}`);
		for (const [key, value] of Object.entries(query ?? {}))
			if (value !== undefined) url.searchParams.set(key, String(value));
		let response: Response;
		try {
			response = await this.fetchImpl(url, {
				method,
				headers: {
					Authorization: `Bearer ${this.accessToken}`,
					...(body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			throw new BeeperError(
				0,
				`can't reach Beeper Desktop at ${this.baseURL} (is it running with the API enabled?): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			const hint = response.status === 401 ? " (token rejected: run `brian connect beeper`)" : "";
			throw new BeeperError(
				response.status,
				`Beeper ${method} ${path} failed: ${response.status}${hint} ${text.slice(0, 200)}`.trim(),
			);
		}
		return (await response.json()) as T;
	}

	accounts(): Promise<BeeperAccount[]> {
		return this.request("GET", "/v1/accounts");
	}

	async chats(limit = 50): Promise<BeeperChat[]> {
		return (await this.request<BeeperPage<BeeperChat>>("GET", "/v1/chats", { limit })).items;
	}

	chat(chatID: string): Promise<BeeperChat> {
		return this.request("GET", `/v1/chats/${encodeURIComponent(chatID)}`);
	}

	/** Recent messages in a chat, oldest first. */
	async messages(chatID: string): Promise<BeeperMessage[]> {
		const page = await this.request<BeeperPage<BeeperMessage>>(
			"GET",
			`/v1/chats/${encodeURIComponent(chatID)}/messages`,
		);
		return [...page.items].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	}

	async search(query: string, limit = 20): Promise<BeeperMessage[]> {
		return (await this.request<BeeperPage<BeeperMessage>>("GET", "/v1/messages/search", { query, limit })).items;
	}

	send(
		chatID: string,
		text: string,
		replyToMessageID?: string,
	): Promise<{ chatID: string; pendingMessageID: string }> {
		return this.request("POST", `/v1/chats/${encodeURIComponent(chatID)}/messages`, undefined, {
			text,
			...(replyToMessageID ? { replyToMessageID } : {}),
		});
	}

	/** Open Beeper Desktop on a chat with text prefilled in the composer, without sending. */
	focus(chatID: string, draftText?: string): Promise<{ success: boolean }> {
		return this.request("POST", "/v1/focus", undefined, { chatID, ...(draftText ? { draftText } : {}) });
	}
}
