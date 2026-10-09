import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@punch-bot/agent";
import type { Model } from "@punch-bot/ai";
import { getModel, streamSimple } from "@punch-bot/ai/compat";
import { getBuiltinModels, getBuiltinProviders } from "@punch-bot/ai/providers/all";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import {
	defaultModelPerProvider,
	findInitialModel,
	resolveCliModel,
	resolveModelScopeWithDiagnostics,
} from "../src/core/model-resolver.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

// Mock models for testing
const mockModels: Model<"anthropic-messages">[] = [
	{
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "gpt-4o",
		name: "GPT-4o",
		api: "anthropic-messages", // Using same type for simplicity
		provider: "openai",
		baseUrl: "https://api.openai.com",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
];

// Mock OpenRouter models with colons in IDs
const mockOpenRouterModels: Model<"anthropic-messages">[] = [
	{
		id: "qwen/qwen3-coder:exacto",
		name: "Qwen3 Coder Exacto",
		api: "anthropic-messages",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	{
		id: "openai/gpt-4o:extended",
		name: "GPT-4o Extended",
		api: "anthropic-messages",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
];

const allModels = [...mockModels, ...mockOpenRouterModels];

function runtimeFor(models: Model<"anthropic-messages">[], available = models) {
	return {
		getModels: () => models,
		getAvailable: async () => available,
	} as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];
}

function withId(id: string, provider: string): Model<"anthropic-messages"> {
	return { ...mockModels[1], id, name: id, provider };
}

describe("resolveCliModel", () => {
	test("selects the same model from provider/id, --provider, and a redundant prefix", () => {
		const modelRuntime = runtimeFor(allModels);
		for (const options of [
			{ cliModel: "openrouter/qwen/qwen3-coder:exacto" },
			{ cliProvider: "openrouter", cliModel: "qwen/qwen3-coder:exacto" },
			{ cliProvider: "openrouter", cliModel: "openrouter/qwen/qwen3-coder:exacto" },
		]) {
			const result = resolveCliModel({ ...options, modelRuntime });
			expect(result.error).toBeUndefined();
			expect(result.model).toBe(mockOpenRouterModels[0]);
		}
	});

	test("ignores case only when a single model matches", () => {
		const lower = withId("vendor/model", "openrouter");
		const upper = withId("Vendor/Model", "openrouter");
		const other = withId("vendor/other", "openrouter");
		expect(resolveCliModel({ cliModel: "OpenRouter/VENDOR/OTHER", modelRuntime: runtimeFor([other]) }).model).toBe(
			other,
		);
		const both = runtimeFor([lower, upper]);
		expect(resolveCliModel({ cliModel: "openrouter/Vendor/Model", modelRuntime: both }).model).toBe(upper);
		expect(resolveCliModel({ cliModel: "openrouter/VENDOR/MODEL", modelRuntime: both }).error).toContain("ambiguous");
	});

	test("does not match partial IDs or invent missing models", () => {
		const modelRuntime = runtimeFor(allModels);
		for (const cliModel of ["sonnet", "anthropic/sonnet", "openrouter/qwen", "openai/gpt-5-missing", ""]) {
			const result = resolveCliModel({ cliModel, modelRuntime });
			expect(result.model).toBeUndefined();
			expect(result.error).toContain("not found");
		}
		expect(resolveCliModel({ cliProvider: "nope", cliModel: "gpt-4o", modelRuntime }).error).toContain(
			'Unknown provider "nope"',
		);
	});

	test("strips one valid thinking suffix only when the full ID is not in the catalog", () => {
		const modelRuntime = runtimeFor([...allModels, withId("vendor/model:high", "openrouter")]);
		expect(resolveCliModel({ cliModel: "openai/gpt-4o:medium", modelRuntime })).toMatchObject({
			model: { provider: "openai", id: "gpt-4o" },
			thinkingLevel: "medium",
		});
		expect(resolveCliModel({ cliModel: "openrouter/vendor/model:high", modelRuntime })).toMatchObject({
			model: { id: "vendor/model:high" },
			thinkingLevel: undefined,
		});
		expect(resolveCliModel({ cliModel: "openai/gpt-4o:banana", modelRuntime }).model).toBeUndefined();
	});

	test("prefers the provider/id split over a gateway model whose ID has the same text", () => {
		const zaiModel = withId("glm-5", "zai");
		const gatewayModel = withId("zai/glm-5", "vercel-ai-gateway");
		const modelRuntime = runtimeFor([zaiModel, gatewayModel]);
		expect(resolveCliModel({ cliModel: "zai/glm-5", modelRuntime }).model).toBe(zaiModel);
		expect(resolveCliModel({ cliModel: "vercel-ai-gateway/zai/glm-5", modelRuntime }).model).toBe(gatewayModel);
	});

	test("rejects a bare ID that exists under more than one provider", () => {
		const modelRuntime = runtimeFor([
			withId("gpt-5.6-sol", "azure-openai-responses"),
			withId("gpt-5.6-sol", "openai"),
		]);
		const result = resolveCliModel({ cliModel: "gpt-5.6-sol", modelRuntime });
		expect(result.model).toBeUndefined();
		expect(result.error).toBe(
			'Model "gpt-5.6-sol" is ambiguous: azure-openai-responses/gpt-5.6-sol, openai/gpt-5.6-sol. Use --provider or provider/model.',
		);
	});
});

describe("resolveModelScopeWithDiagnostics", () => {
	test("returns structured diagnostics without writing console warnings", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const result = await resolveModelScopeWithDiagnostics(
				["anthropic/claude-sonnet-4-5:high", "openai/gpt-4o", "sonnet"],
				runtimeFor(allModels, mockModels.slice(0, 1)),
			);
			expect(result.scopedModels).toEqual([{ model: mockModels[0], thinkingLevel: "high" }]);
			expect(result.diagnostics).toEqual([
				{
					type: "warning",
					code: "no-match",
					message: 'Model "openai/gpt-4o" is unavailable. Configure authentication for its provider.',
					pattern: "openai/gpt-4o",
				},
				{
					type: "warning",
					code: "no-match",
					message: 'Model "sonnet" not found. Use --list-models or define the exact model in models.json.',
					pattern: "sonnet",
				},
			]);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	test("resolves literal bracketed IDs before treating them as globs", async () => {
		const bracketed = withId("bracketed-model[1m]", "custom");
		const result = await resolveModelScopeWithDiagnostics(
			["custom/bracketed-model[1m]:high"],
			runtimeFor([...allModels, bracketed]),
		);
		expect(result.scopedModels).toEqual([{ model: bracketed, thinkingLevel: "high" }]);
		expect(result.diagnostics).toEqual([]);
	});

	test("limits provider-prefixed globs to that provider", async () => {
		const gatewayModel = withId("openai/gpt-4o", "vercel-ai-gateway");
		const azureModel = withId("gpt-4o-mini", "azure-openai-responses");
		const modelRuntime = runtimeFor([...allModels, gatewayModel, azureModel]);
		const prefixed = await resolveModelScopeWithDiagnostics(["openai/*:low"], modelRuntime);
		expect(prefixed.scopedModels).toEqual([{ model: mockModels[1], thinkingLevel: "low" }]);
		const bare = await resolveModelScopeWithDiagnostics(["gpt-4o*"], modelRuntime);
		// Bare-ID globs match on model.id across providers; the gateway ID contains "/" and does not match.
		expect(bare.scopedModels.map(({ model }) => `${model.provider}/${model.id}`)).toEqual([
			"openai/gpt-4o",
			"azure-openai-responses/gpt-4o-mini",
		]);
	});
});

describe("default model selection", () => {
	test("openai defaults track current models", () => {
		expect(defaultModelPerProvider.openai).toBe("gpt-5.5");
		expect(defaultModelPerProvider["openai-codex"]).toBe("gpt-5.5");
	});

	test("zai, minimax, cerebras, and ant-ling defaults track current models", () => {
		expect(defaultModelPerProvider.zai).toBe("glm-5.3");
		expect(defaultModelPerProvider["zai-coding-cn"]).toBe("glm-5.3");
		expect(defaultModelPerProvider.minimax).toBe("MiniMax-M2.7");
		expect(defaultModelPerProvider["minimax-cn"]).toBe("MiniMax-M2.7");
		expect(defaultModelPerProvider.cerebras).toBe("gpt-oss-120b");
		expect(defaultModelPerProvider["ant-ling"]).toBe("Ring-2.6-1T");
	});

	test("built-in defaults exist in generated provider catalogs", () => {
		for (const provider of getBuiltinProviders()) {
			const defaultId = defaultModelPerProvider[provider];
			expect(
				getBuiltinModels(provider).some((model) => model.id === defaultId),
				`${provider} default ${defaultId} should exist in its generated catalog`,
			).toBe(true);
		}
	});

	test("ai-gateway default tracks current model", () => {
		expect(defaultModelPerProvider["vercel-ai-gateway"]).toBe("zai/glm-5.1");
	});

	test("xai default tracks current model", () => {
		expect(defaultModelPerProvider.xai).toBe("grok-4.6");
	});

	test("qwen token plan individual default tracks current model", () => {
		expect(defaultModelPerProvider["qwen-token-plan-individual"]).toBe("qwen3.8-max");
	});

	test("findInitialModel selects ai-gateway default when available", async () => {
		const aiGatewayModel: Model<"anthropic-messages"> = {
			id: "anthropic/claude-opus-4-6",
			name: "Claude Opus 4.6",
			api: "anthropic-messages",
			provider: "vercel-ai-gateway",
			baseUrl: "https://ai-gateway.vercel.sh",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
			contextWindow: 200000,
			maxTokens: 8192,
		};

		const registry = {
			getAvailableSnapshot: () => [aiGatewayModel],
		} as unknown as Parameters<typeof findInitialModel>[0]["modelRuntime"];

		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			modelRuntime: registry,
		});

		expect(result.model?.provider).toBe("vercel-ai-gateway");
		expect(result.model?.id).toBe("anthropic/claude-opus-4-6");
	});

	test("findInitialModel ignores an unauthenticated saved default", async () => {
		const savedDeepSeekModel: Model<"anthropic-messages"> = {
			id: "deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			api: "anthropic-messages",
			provider: "deepseek",
			baseUrl: "https://api.deepseek.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
			contextWindow: 128000,
			maxTokens: 8192,
		};
		const localDeepSeekModel: Model<"anthropic-messages"> = {
			...savedDeepSeekModel,
			provider: "spark-two",
			baseUrl: "http://spark-two:8000/v1",
		};
		const registry = {
			getModel: (provider: string, modelId: string) =>
				provider === savedDeepSeekModel.provider && modelId === savedDeepSeekModel.id
					? savedDeepSeekModel
					: undefined,
			hasConfiguredAuth: (provider: string) => provider === "spark-two",
			getAvailableSnapshot: () => [localDeepSeekModel],
		} as unknown as Parameters<typeof findInitialModel>[0]["modelRuntime"];

		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: false,
			defaultProvider: "deepseek",
			defaultModelId: "deepseek-v4-flash",
			strictModelSelection: false,
			modelRuntime: registry,
		});

		expect(result.model?.provider).toBe("spark-two");
		expect(result.model?.id).toBe("deepseek-v4-flash");
	});

	describe("persisted default model scoping", () => {
		const tempDirs: string[] = [];
		const sonnet = getModel("anthropic", "claude-sonnet-4-5")!;
		const opus = getModel("anthropic", "claude-opus-4-8")!;

		afterEach(() => {
			for (const dir of tempDirs.splice(0)) {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		async function createSession(options: { scoped: boolean; persistedScope?: string[] }) {
			const tempDir = join(tmpdir(), `pi-default-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`);
			mkdirSync(tempDir, { recursive: true });
			tempDirs.push(tempDir);

			const settingsManager = SettingsManager.create(tempDir, tempDir);
			if (options.persistedScope) {
				settingsManager.setEnabledModels(options.persistedScope);
			}

			const authStorage = AuthStorage.inMemory({ anthropic: { type: "api_key", key: "test-key" } });
			const modelRuntime = getModelRuntime(await createModelRegistry(authStorage, join(tempDir, "models.json")));
			const agent = new Agent({
				initialState: {
					model: sonnet,
					systemPrompt: "test",
					tools: [],
				},
				streamFn: streamSimple,
			});
			const session = new AgentSession({
				agent,
				sessionManager: SessionManager.inMemory(tempDir),
				settingsManager,
				cwd: tempDir,
				modelRuntime,
				resourceLoader: createTestResourceLoader(),
				scopedModels: options.scoped ? [{ model: sonnet }] : [],
			});

			return { session, settingsManager };
		}

		test("adds a persisted default to an existing scoped model list", async () => {
			const { session, settingsManager } = await createSession({
				scoped: true,
				persistedScope: [`${sonnet.provider}/${sonnet.id}`],
			});

			await session.setModel(opus, { persist: true });

			expect(settingsManager.getDefaultProvider()).toBe(opus.provider);
			expect(settingsManager.getDefaultModel()).toBe(opus.id);
			expect(session.scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`)).toEqual([
				`${sonnet.provider}/${sonnet.id}`,
				`${opus.provider}/${opus.id}`,
			]);
			expect(settingsManager.getEnabledModels()).toEqual([
				`${sonnet.provider}/${sonnet.id}`,
				`${opus.provider}/${opus.id}`,
			]);
		});

		test("does not create a scoped model list when all models are available", async () => {
			const { session, settingsManager } = await createSession({ scoped: false });

			await session.setModel(opus, { persist: true });

			expect(session.scopedModels).toEqual([]);
			expect(settingsManager.getEnabledModels()).toBeUndefined();
		});

		test("keeps session-only model changes out of scope", async () => {
			const { session, settingsManager } = await createSession({
				scoped: true,
				persistedScope: [`${sonnet.provider}/${sonnet.id}`],
			});

			await session.setModel(opus, { persist: false });

			expect(session.scopedModels.map((scoped) => `${scoped.model.provider}/${scoped.model.id}`)).toEqual([
				`${sonnet.provider}/${sonnet.id}`,
			]);
			expect(settingsManager.getEnabledModels()).toEqual([`${sonnet.provider}/${sonnet.id}`]);
		});
	});
});
