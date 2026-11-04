import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import webfetchExtension, { startGuardProxy } from "../src/extensions/webfetch/index.ts";

const servers: Server[] = [];
const browserGlobal = globalThis as { __pi_browser?: unknown };

async function listen(server: Server): Promise<number> {
	servers.push(server);
	if (!server.listening) {
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
	}
	return (server.address() as AddressInfo).port;
}

async function secretServer(): Promise<{ port: number; hits: string[] }> {
	const hits: string[] = [];
	const port = await listen(
		createServer((req, res) => {
			hits.push(req.url ?? "");
			res.end("secret");
		}),
	);
	return { port, hits };
}

function proxyGet(proxyPort: number, url: string): Promise<{ status: number; headers: Record<string, unknown> }> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: url }, (res) => {
			res.resume();
			resolve({ status: res.statusCode ?? 0, headers: res.headers });
		});
		req.on("error", reject);
		req.end();
	});
}

function proxyConnect(proxyPort: number, authority: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: authority });
		req.on("connect", (res, socket) => {
			socket.destroy();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", reject);
		req.end();
	});
}

afterEach(async () => {
	delete browserGlobal.__pi_browser;
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				}),
		),
	);
});

describe("webfetch extension", () => {
	it("does not retry blocked URLs through the browser", async () => {
		browserGlobal.__pi_browser = {};
		const { port, hits } = await secretServer();
		const extension = await loadExtensionFromFactory(
			webfetchExtension,
			process.cwd(),
			createEventBus(),
			createExtensionRuntime(),
			"builtin:webfetch",
		);
		const tool = extension.tools.get("webfetch")?.definition;
		expect(tool).toBeDefined();
		await expect(
			tool?.execute("call-1", { url: `http://127.0.0.1:${port}/secret` }, undefined, undefined, undefined as never),
		).rejects.toThrow("URLs pointing at loopback, private, or link-local addresses are not allowed");
		expect(hits).toEqual([]);
	});

	it("guard proxy refuses plain HTTP requests to private addresses", async () => {
		const { port, hits } = await secretServer();
		const proxyPort = await listen(await startGuardProxy());
		const response = await proxyGet(proxyPort, `http://127.0.0.1:${port}/secret`);
		expect(response.status).toBe(403);
		expect(response.headers["x-brian-webfetch-blocked"]).toBe("1");
		const metadata = await proxyGet(proxyPort, "http://169.254.169.254/latest/meta-data/");
		expect(metadata.status).toBe(403);
		expect(hits).toEqual([]);
	});

	it("guard proxy refuses CONNECT tunnels to private addresses", async () => {
		const { port, hits } = await secretServer();
		const proxyPort = await listen(await startGuardProxy());
		expect(await proxyConnect(proxyPort, `127.0.0.1:${port}`)).toBe(403);
		expect(await proxyConnect(proxyPort, `localhost:${port}`)).toBe(403);
		expect(await proxyConnect(proxyPort, `[::1]:${port}`)).toBe(403);
		expect(await proxyConnect(proxyPort, "10.0.0.1:443")).toBe(403);
		expect(hits).toEqual([]);
	});
});
