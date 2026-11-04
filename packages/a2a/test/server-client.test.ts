import { request } from "node:http";
import { describe, expect, test } from "vitest";
import { delegateToA2aAgent } from "../src/client.ts";
import { createA2aServer } from "../src/server.ts";

function echoServer() {
	return createA2aServer({
		runnerFactory: () => ({
			async prompt(text) {
				return { text: `echo:${text}` };
			},
		}),
	});
}

function rawRequest(
	url: string,
	headers: Record<string, string>,
	method = "POST",
): Promise<{ status: number; body: string }> {
	const target = new URL(url);
	const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params: {} });
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: target.hostname,
				port: target.port,
				path: target.pathname,
				method,
				headers: { "content-type": "application/json", ...headers },
			},
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					text += chunk;
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
			},
		);
		req.on("error", reject);
		if (method === "POST") req.write(body);
		req.end();
	});
}

describe("A2A server and client", () => {
	test("delegates to a local A2A agent", async () => {
		const server = await createA2aServer({
			runnerFactory: () => ({
				async prompt(text) {
					return { text: `echo:${text}` };
				},
			}),
		});
		const bound = await server.listen(0, "127.0.0.1");
		try {
			const result = await delegateToA2aAgent({
				url: bound.url,
				task: "ping",
				token: server.token,
			});
			expect(result.text).toBe("echo:ping");
			expect(result.failed).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	test("surfaces harness failures to callers", async () => {
		const server = await createA2aServer({
			runnerFactory: () => ({
				async prompt() {
					return { message: "boom" };
				},
			}),
		});
		const bound = await server.listen(0, "127.0.0.1");
		try {
			const result = await delegateToA2aAgent({
				url: bound.url,
				task: "fail",
				token: server.token,
			});
			expect(result.failed).toBe(true);
			expect(result.error).toBe("boom");
			expect(result.text).toBe("boom");
		} finally {
			await server.close();
		}
	});

	test("rejects JSON-RPC calls without the bearer token", async () => {
		const server = await echoServer();
		const bound = await server.listen(0, "127.0.0.1");
		try {
			expect((await rawRequest(bound.url, {})).status).toBe(401);
			expect((await rawRequest(bound.url, { authorization: "Bearer wrong" })).status).toBe(401);
			await expect(delegateToA2aAgent({ url: bound.url, task: "ping" })).rejects.toThrow();
			const ok = await rawRequest(bound.url, { authorization: `Bearer ${server.token}` });
			expect([401, 403]).not.toContain(ok.status);
		} finally {
			await server.close();
		}
	});

	test("rejects requests for a Host other than the bound address", async () => {
		const server = await echoServer();
		const bound = await server.listen(0, "127.0.0.1");
		const auth = { authorization: `Bearer ${server.token}` };
		try {
			expect((await rawRequest(bound.url, { ...auth, host: "evil.example" })).status).toBe(403);
			expect((await rawRequest(bound.url, { ...auth, host: `evil.example:${bound.port}` })).status).toBe(403);
			expect((await rawRequest(bound.url, { ...auth, host: "127.0.0.1:1" })).status).toBe(403);
			const card = `${bound.url}.well-known/agent-card.json`;
			expect((await rawRequest(card, { host: "evil.example" }, "GET")).status).toBe(403);
			expect((await rawRequest(card, {}, "GET")).status).toBe(200);
			const local = await rawRequest(bound.url, { ...auth, host: `localhost:${bound.port}` });
			expect([401, 403]).not.toContain(local.status);
		} finally {
			await server.close();
		}
	});

	test("uses a caller-provided token", async () => {
		const server = await createA2aServer({
			token: "fixed-token",
			runnerFactory: () => ({
				async prompt(text) {
					return { text };
				},
			}),
		});
		expect(server.token).toBe("fixed-token");
		const bound = await server.listen(0, "127.0.0.1");
		try {
			const result = await delegateToA2aAgent({ url: bound.url, task: "hi", token: "fixed-token" });
			expect(result.text).toBe("hi");
		} finally {
			await server.close();
		}
	});
});
