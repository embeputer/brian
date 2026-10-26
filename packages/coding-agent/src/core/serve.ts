import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { APP_NAME, getAgentDir, VERSION } from "../config.ts";

export const DEFAULT_SERVE_PORT = 7333;
const MAX_BODY = 1024 * 1024;

export interface ServeConfig {
	host: string;
	port: number;
	token: string;
}

export function getServeConfigPath(): string {
	return join(getAgentDir(), "serve.json");
}

/** Load the server settings, creating a random token on first use. The file is 0600. */
export function loadServeConfig(file: string = getServeConfigPath()): ServeConfig {
	let saved: Partial<ServeConfig> = {};
	if (existsSync(file)) saved = JSON.parse(readFileSync(file, "utf8")) as Partial<ServeConfig>;
	const config: ServeConfig = {
		host: saved.host ?? "127.0.0.1",
		port: saved.port ?? DEFAULT_SERVE_PORT,
		token: saved.token ?? randomBytes(24).toString("base64url"),
	};
	if (saved.token !== config.token || saved.host !== config.host || saved.port !== config.port) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
		chmodSync(file, 0o600);
	}
	return config;
}

export interface ServeHandlers {
	status(): Record<string, unknown>;
	prompt(text: string): Promise<string>;
}

function send(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, token: string): boolean {
	const header = req.headers.authorization ?? "";
	const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
	const expected = Buffer.from(token);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY) throw new Error("body too large");
		chunks.push(chunk as Buffer);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/**
 * Brian's local API. Only /v1/health is open; everything else needs `Authorization: Bearer <token>`.
 *   GET  /v1/health  -> { ok, name, version }
 *   GET  /v1/status  -> what the background loops are doing
 *   POST /v1/prompt  { prompt } -> { text }
 */
export function startServer(config: ServeConfig, handlers: ServeHandlers): Promise<{ server: Server; url: string }> {
	const server = createServer(async (req, res) => {
		try {
			const path = new URL(req.url ?? "/", "http://localhost").pathname;
			if (req.method === "GET" && path === "/v1/health")
				return send(res, 200, { ok: true, name: APP_NAME, version: VERSION });
			if (!authorized(req, config.token)) return send(res, 401, { error: "unauthorized" });
			if (req.method === "GET" && path === "/v1/status") return send(res, 200, handlers.status());
			if (req.method === "POST" && path === "/v1/prompt") {
				const body = (await readJson(req)) as { prompt?: unknown };
				if (typeof body.prompt !== "string" || !body.prompt.trim())
					return send(res, 400, { error: "prompt is required" });
				return send(res, 200, { text: await handlers.prompt(body.prompt) });
			}
			send(res, 404, { error: "not found" });
		} catch (error) {
			send(res, 500, { error: error instanceof Error ? error.message : String(error) });
		}
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.host, () => {
			const { port } = server.address() as AddressInfo;
			resolve({ server, url: `http://${config.host}:${port}` });
		});
	});
}

export interface Loop {
	name: string;
	intervalMs: number;
	tick(): Promise<void>;
}

/** Run each loop now and then every interval, never overlapping a loop with itself. Returns a stop function. */
export function startLoops(loops: Loop[], onError: (name: string, error: unknown) => void): () => void {
	const timers: NodeJS.Timeout[] = [];
	let stopped = false;
	for (const loop of loops) {
		const run = async () => {
			try {
				await loop.tick();
			} catch (error) {
				onError(loop.name, error);
			}
			if (!stopped) timers.push(setTimeout(run, loop.intervalMs));
		};
		void run();
	}
	return () => {
		stopped = true;
		for (const timer of timers) clearTimeout(timer);
	};
}
