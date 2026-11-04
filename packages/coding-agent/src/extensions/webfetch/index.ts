import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { once } from "node:events";
import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { type AddressInfo, connect, isIP } from "node:net";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import type * as Playwright from "playwright";
import type { Browser } from "playwright";
import { Type } from "typebox";
import { Agent, type Dispatcher, request } from "undici";
import type { ExtensionAPI } from "../../core/extensions/types.ts";

function stripHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function expandIpv6(address: string): string {
	const withoutZone = address.split("%")[0];
	if (!withoutZone.includes("::")) return withoutZone;
	const [head, tail] = withoutZone.split("::");
	const headParts = head ? head.split(":") : [];
	const tailParts = tail ? tail.split(":") : [];
	const missing = Math.max(0, 8 - headParts.length - tailParts.length);
	return [...headParts, ...Array(missing).fill("0"), ...tailParts].join(":");
}

function isIpv4MappedToV6(address: string): string | null {
	const withoutZone = address.toLowerCase().split("%")[0];
	if (!withoutZone.includes(":")) return null;
	const parts = expandIpv6(withoutZone).split(":");
	if (parts.length !== 8) return null;
	if (parts[7].includes(".")) {
		const head = parts.slice(0, 7).map((part) => Number.parseInt(part, 16));
		if (head.some((value) => Number.isNaN(value))) return null;
		const mapped = head[6] === 0xffff && head.slice(0, 6).every((value) => value === 0);
		const compatible = head.every((value) => value === 0);
		if (!mapped && !compatible) return null;
		return parts[7];
	}
	const values = parts.map((part) => Number.parseInt(part, 16));
	if (values.some((value) => Number.isNaN(value))) return null;
	const mapped = values[5] === 0xffff && values.slice(0, 5).every((value) => value === 0);
	const compatible = values.slice(0, 7).every((value) => value === 0);
	if (!mapped && !compatible) return null;
	return `${values[6] >> 8}.${values[6] & 0xff}.${values[7] >> 8}.${values[7] & 0xff}`;
}

function isBlockedIp(ip: string): boolean {
	const v = ip.toLowerCase();
	if (v === "::1" || v === "::" || v === "0.0.0.0") return true;
	const mapped = isIpv4MappedToV6(v);
	if (mapped !== null) return isBlockedIp(mapped);
	if (v.includes(":")) {
		const first = Number.parseInt(expandIpv6(v).split(":")[0], 16);
		if (Number.isNaN(first)) return false;
		if (first >= 0xfc00 && first <= 0xfdff) return true;
		if (first >= 0xfe80 && first <= 0xfebf) return true;
		return false;
	}
	if (/^127\./.test(v) || /^169\.254\./.test(v) || /^10\./.test(v) || /^192\.168\./.test(v)) return true;
	if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true;
	return /^172\.(1[6-9]|2\d|3[01])\./.test(v);
}

/** The URL itself is not allowed (bad scheme, private address). Never retried through the browser. */
class BlockedUrlError extends Error {}

interface SafeTarget {
	url: URL;
	hostname: string;
	addresses: string[];
}

async function resolveSafe(value: string): Promise<SafeTarget> {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new BlockedUrlError(`Invalid URL: ${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new BlockedUrlError("Only http and https URLs are supported");
	}
	let hostname = parsed.hostname.toLowerCase();
	if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
	if (hostname === "localhost") {
		throw new BlockedUrlError("URLs pointing at loopback addresses are not allowed");
	}
	let addresses: string[];
	const literalFamily = isIP(hostname);
	if (literalFamily !== 0) {
		addresses = [hostname];
	} else {
		try {
			addresses = (await lookup(hostname, { all: true })).map((entry) => entry.address);
		} catch {
			throw new Error(`Could not resolve host: ${hostname}`);
		}
	}
	for (const address of addresses) {
		if (isBlockedIp(address)) {
			throw new BlockedUrlError("URLs pointing at loopback, private, or link-local addresses are not allowed");
		}
	}
	return { url: parsed, hostname, addresses };
}

function pinnedAgent(target: SafeTarget): Agent {
	return new Agent({
		connect: {
			lookup: (
				host: string,
				options: LookupOptions,
				callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
			) => {
				if (host !== target.hostname) {
					callback(new Error(`unexpected host ${host}`), []);
					return;
				}
				const entries: LookupAddress[] = target.addresses.map((address) => ({
					address,
					family: isIP(address) === 6 ? 6 : 4,
				}));
				if (options.all) {
					callback(null, entries);
					return;
				}
				const first = entries[0];
				callback(null, first.address, first.family);
			},
		},
	});
}

const MAX_REDIRECTS = 5;

async function fetchText(url: string, rawLimit: number): Promise<{ text: string; contentType: string }> {
	let current = url;
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
		const target = await resolveSafe(current);
		const agent = pinnedAgent(target);
		try {
			const res = await request(target.url.toString(), {
				dispatcher: agent,
				method: "GET",
				signal: AbortSignal.timeout(15_000),
			});
			const location = res.headers.location;
			if (res.statusCode >= 300 && res.statusCode < 400) {
				await res.body.dump();
				if (!location) throw new Error(`HTTP ${res.statusCode} with no redirect location`);
				if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects");
				current = new URL(location, target.url).toString();
				continue;
			}
			if (res.statusCode < 200 || res.statusCode >= 300) {
				await res.body.dump();
				throw new Error(`HTTP ${res.statusCode}`);
			}
			const contentType = String(res.headers["content-type"] ?? "");
			const decoder = new TextDecoder();
			let text = "";
			for await (const chunk of res.body) {
				text += decoder.decode(chunk as Uint8Array, { stream: true });
				if (text.length >= rawLimit) break;
			}
			return { text, contentType };
		} finally {
			void agent.close();
		}
	}
	throw new Error("Too many redirects");
}

const BLOCKED_HEADER = "x-brian-webfetch-blocked";
const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"host",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

function forwardableHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
	const result: IncomingHttpHeaders = {};
	for (const [name, value] of Object.entries(headers)) {
		if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) result[name] = value;
	}
	return result;
}

async function proxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	try {
		const target = await resolveSafe(req.url ?? "");
		const agent = pinnedAgent(target);
		try {
			const method = (req.method ?? "GET") as Dispatcher.HttpMethod;
			const upstream = await request(target.url.toString(), {
				dispatcher: agent,
				method,
				headers: forwardableHeaders(req.headers),
				body: method === "GET" || method === "HEAD" ? undefined : req,
			});
			res.writeHead(upstream.statusCode, forwardableHeaders(upstream.headers));
			await pipeline(upstream.body, res);
		} finally {
			void agent.close();
		}
	} catch (err) {
		if (res.headersSent) {
			res.destroy();
			return;
		}
		const blocked = err instanceof BlockedUrlError;
		res.writeHead(blocked ? 403 : 502, {
			"content-type": "text/plain",
			...(blocked ? { [BLOCKED_HEADER]: "1" } : {}),
		});
		res.end((err as Error).message);
	}
}

async function proxyConnect(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
	socket.on("error", () => socket.destroy());
	let target: SafeTarget;
	try {
		target = await resolveSafe(`https://${req.url ?? ""}`);
	} catch (err) {
		socket.end(`HTTP/1.1 ${err instanceof BlockedUrlError ? "403 Forbidden" : "502 Bad Gateway"}\r\n\r\n`);
		return;
	}
	const upstream = connect({ host: target.addresses[0], port: Number(target.url.port) || 443 });
	upstream.once("connect", () => {
		socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
		if (head.length > 0) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
	upstream.on("error", () => {
		if (upstream.connecting) socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
		else socket.destroy();
	});
	socket.on("close", () => upstream.destroy());
}

/**
 * Local HTTP proxy for the webfetch browser. Every request, redirect hop, worker fetch, popup, and WebSocket
 * from that browser passes through it, so each target is checked with resolveSafe and connected to the
 * checked address. Chromium sends host names to the proxy unresolved, so DNS rebinding cannot bypass it.
 */
export async function startGuardProxy(): Promise<Server> {
	const server = createServer((req, res) => void proxyRequest(req, res));
	server.on("connect", (req: IncomingMessage, socket: Duplex, head: Buffer) => void proxyConnect(req, socket, head));
	server.on("upgrade", (_req: IncomingMessage, socket: Duplex) => socket.destroy());
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return server;
}

let guardedBrowserPromise: Promise<Browser> | null = null;

async function launchGuardedBrowser(): Promise<Browser> {
	const proxy = await startGuardProxy();
	proxy.unref();
	const { port } = proxy.address() as AddressInfo;
	try {
		// Loaded on first use, like the browser extension: playwright is not available in every install.
		const { chromium } = createRequire(import.meta.url)("playwright") as typeof Playwright;
		const browser = await chromium.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
			// "<-loopback>" removes Chromium's built-in proxy bypass for localhost and 127.0.0.1.
			proxy: { server: `http://127.0.0.1:${port}`, bypass: "<-loopback>" },
		});
		browser.on("disconnected", () => {
			guardedBrowserPromise = null;
			proxy.close();
		});
		return browser;
	} catch (err) {
		proxy.close();
		throw err;
	}
}

function getGuardedBrowser(): Promise<Browser> {
	if (!guardedBrowserPromise) {
		guardedBrowserPromise = launchGuardedBrowser().catch((err) => {
			guardedBrowserPromise = null;
			throw err;
		});
	}
	return guardedBrowserPromise;
}

// A separate browser instead of the browser extension's shared context: that context has the user's profile
// and connects directly, and page.route cannot see redirect hops, popups, or worker traffic.
async function fetchWithBrowser(url: string, maxChars: number): Promise<string> {
	const safeTarget = await resolveSafe(url);
	const browser = await getGuardedBrowser();
	const context = await browser.newContext({ serviceWorkers: "block" });
	try {
		await context.routeWebSocket("**/*", (ws) => ws.close());
		const page = await context.newPage();
		const response = await page.goto(safeTarget.url.toString(), {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		if (response?.headers()[BLOCKED_HEADER]) throw new BlockedUrlError(await response.text());
		await new Promise((resolve) => setTimeout(resolve, 2_000));
		return await page.evaluate<string>(
			`(() => { const max = ${maxChars}; const el = document.querySelector("article, main, [role='main'], .content, #content") || document.body; return (el?.innerText ?? document.title).slice(0, max); })()`,
		);
	} finally {
		await context.close();
	}
}

export default function webfetchExtension(brian: ExtensionAPI): void {
	brian.registerTool({
		name: "webfetch",
		label: "Fetch web page",
		description: "Fetch a URL and return readable text content",
		promptSnippet: "Fetch and read a web page",
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			maxChars: Type.Optional(Type.Number({ minimum: 1, description: "Maximum characters" })),
		}),
		async execute(_toolCallId, args) {
			const url = String(args.url);
			const maxChars = Math.max(1, Math.floor(Number(args.maxChars) || 15000));
			const rawLimit = Math.min(Math.max(maxChars * 8, 64 * 1024), 4 * 1024 * 1024);
			try {
				const { text, contentType } = await fetchText(url, rawLimit);
				const clean = contentType.includes("text/html") ? stripHtml(text) : text;
				return { content: [{ type: "text" as const, text: clean.slice(0, maxChars) }], details: {} };
			} catch (err) {
				if (err instanceof BlockedUrlError) throw err;
				const message = (err as Error).message;
				// The browser extension sets this once it has launched Chromium, so Playwright is usable.
				if (!(globalThis as { __pi_browser?: unknown }).__pi_browser) {
					throw new Error(`Could not fetch ${url}. No browser available and fetch failed: ${message}`);
				}
				const text = await fetchWithBrowser(url, maxChars);
				return { content: [{ type: "text" as const, text }], details: {} };
			}
		},
	});
}
