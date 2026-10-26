import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InMemoryCredentialStore } from "@brian-agent/ai";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { allowNetwork } from "./test-network-env.ts";

// Runs the current client against the static catalog layout written by
// scripts/publish-model-catalog.mjs to the `model-catalog` branch.

const modelId = "test/brand-new-model";
const newModel = {
	type: "chat",
	id: modelId,
	name: "Brand New Model",
	api: "openai-completions",
	provider: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};
// Newer than the bundled catalog, so the client applies the remote overlay.
const shard = { generatedAt: "2099-01-01T00:00:00.000Z", revision: `sha256-${"a".repeat(64)}`, models: [newModel] };

function startCatalogServer(requests: string[]): Promise<Server> {
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		if (request.url === "/model-catalog/v1/providers/openrouter.json") {
			response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(shard));
		} else {
			response.writeHead(404).end();
		}
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

describe("remote model catalog with the current client", () => {
	const requests: string[] = [];
	let server: Server;
	let catalogBaseUrl: string;

	beforeAll(async () => {
		server = await startCatalogServer(requests);
		catalogBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/model-catalog`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});

	it("adds models from the published catalog that the bundled catalog does not have", async () => {
		allowNetwork();
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			catalogBaseUrl,
			refreshOnCreate: false,
		});
		expect(runtime.getModel("openrouter", modelId)).toBeUndefined();
		await runtime.setRuntimeApiKey("openrouter", "test-key");
		// Keep the key-personalization request (`GET /models/user`) off the real network.
		const nativeFetch = globalThis.fetch;
		vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const request = new Request(input, init);
			if (new URL(request.url).origin === "https://openrouter.ai") return new Response(null, { status: 404 });
			return nativeFetch(request);
		});
		const refresh = await runtime
			.refresh({ allowNetwork: true, force: true, providers: ["openrouter"] })
			.finally(() => vi.unstubAllGlobals());

		expect([...refresh.errors]).toEqual([]);
		expect(requests).toEqual(["/model-catalog/v1/providers/openrouter.json"]);
		expect(runtime.getModel("openrouter", modelId)).toMatchObject({
			api: "openai-completions",
			contextWindow: 200_000,
		});
	});
});
