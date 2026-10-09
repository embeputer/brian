import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@punch-bot/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
} from "../../../src/core/agent-session-runtime.ts";
import {
	findInitialModel,
	resolveCliModel,
	resolveModelScopeFromModels,
	resolveModelScopeWithDiagnostics,
} from "../../../src/core/model-resolver.ts";
import { createAgentSession } from "../../../src/core/sdk.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { createTestResourceLoader } from "../../utilities.ts";
import { createHarness, type Harness } from "../harness.ts";

describe("regressions #2954 and #3042: exact OpenRouter selection", () => {
	let harness: Harness;
	const cleanups: Array<() => void | Promise<void>> = [];

	beforeEach(async () => {
		harness = await createHarness();
	});

	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
		harness.cleanup();
	});

	async function catalog(ids: string[], provider = "openrouter") {
		const faux = fauxProvider({ provider, models: ids.map((id) => ({ id, reasoning: true })) });
		harness.session.modelRuntime.registerNativeProvider(faux.provider);
		await harness.session.modelRuntime.refresh({ allowNetwork: false });
		return faux;
	}

	function resolve(cliModel: string, cliProvider?: string) {
		return resolveCliModel({ cliModel, cliProvider, modelRuntime: harness.session.modelRuntime });
	}

	it("selects exactly the requested base or variant when both exist", async () => {
		const ids = ["fixture/model", "fixture/model:free", "fixture/model:batch", "fixture/model:future-service"];
		const faux = await catalog(ids);
		for (const id of ids) {
			for (const result of [
				resolve(id, "openrouter"),
				resolve(`openrouter/${id}`),
				resolve(`openrouter/${id}`, "openrouter"),
			]) {
				expect(result.model).toBe(faux.getModel(id));
				expect(result.error).toBeUndefined();
				expect(result.thinkingLevel).toBeUndefined();
			}
		}
	});

	it("rejects a missing base when only its service variants exist", async () => {
		await catalog(["fixture/model:free", "fixture/model:batch"]);
		for (const result of [
			resolve("fixture/model", "openrouter"),
			resolve("openrouter/fixture/model"),
			resolve("fixture/model"),
			resolve("model", "openrouter"),
			resolve("fixture/model:typo", "openrouter"),
		]) {
			expect(result.model).toBeUndefined();
			expect(result.error).toContain("not found");
			expect(result.error).toContain("models.json");
		}
	});

	it("uses exact IDs in automation scopes and keeps explicitly requested globs", async () => {
		const faux = await catalog(["fixture/model:free", "fixture/model:batch", "fixture/model-plus"]);
		const missing = resolveModelScopeFromModels(["openrouter/fixture/model", "fixture/model"], faux.models);
		expect(missing.scopedModels).toEqual([]);
		expect(missing.diagnostics).toHaveLength(2);
		const variant = resolveModelScopeFromModels(["openrouter/fixture/model:free:high"], faux.models);
		expect(variant.scopedModels).toMatchObject([{ model: { id: "fixture/model:free" }, thinkingLevel: "high" }]);
		const glob = resolveModelScopeFromModels(["openrouter/fixture/model:*"], faux.models);
		expect(glob.scopedModels.map((scoped) => scoped.model.id)).toEqual(["fixture/model:free", "fixture/model:batch"]);
	});

	it("preserves raw IDs starting with the explicit provider name", async () => {
		await catalog(["openrouter/fusion", "fusion", "openrouter/fusion:free"]);
		expect(resolve("openrouter/fusion", "openrouter").model?.id).toBe("openrouter/fusion");
		expect(resolve("openrouter/fusion:free:high", "openrouter")).toMatchObject({
			model: { id: "openrouter/fusion:free" },
			thinkingLevel: "high",
		});
		expect(resolve("openrouter/openrouter/fusion").model?.id).toBe("openrouter/fusion");
	});

	it("does not change an inferred provider based on authentication or a missing ID", async () => {
		await catalog(["fixture/model"], "vendor");
		await catalog(["vendor/fixture/model", "vendor/missing"]);
		expect(resolve("vendor/fixture/model").model?.provider).toBe("vendor");
		expect(resolve("vendor/missing").error).toContain("not found");
		expect(resolve("vendor/fixture/model", "unknown").model).toBeUndefined();
	});

	it("rejects ambiguous bare IDs even when only one provider has credentials", async () => {
		await catalog(["fixture/model"]);
		const other = fauxProvider({ provider: "gateway", models: [{ id: "fixture/model" }] });
		harness.session.modelRuntime.registerNativeProvider({ ...other.provider, auth: {} });
		await harness.session.modelRuntime.refresh({ allowNetwork: false });
		expect(harness.session.modelRuntime.hasConfiguredAuth("gateway")).toBe(false);
		for (const id of ["fixture/model", "fixture/model:high"]) {
			expect(resolve(id).error).toContain("ambiguous");
		}
		expect(resolve("fixture/model", "openrouter").model?.provider).toBe("openrouter");
		const scope = await resolveModelScopeWithDiagnostics(["fixture/model"], harness.session.modelRuntime);
		expect(scope.scopedModels).toEqual([]);
		expect(scope.diagnostics[0]?.message).toContain("ambiguous");
	});

	it("does not reinterpret an unavailable scoped provider as an OpenRouter vendor", async () => {
		const vendor = fauxProvider({ provider: "vendor", models: [{ id: "fixture/model" }] });
		harness.session.modelRuntime.registerNativeProvider({ ...vendor.provider, auth: {} });
		await catalog(["vendor/fixture/model"]);
		const scope = await resolveModelScopeWithDiagnostics(
			["vendor/fixture/model", "vendor/*"],
			harness.session.modelRuntime,
		);
		expect(scope.scopedModels).toEqual([]);
		expect(scope.diagnostics).toHaveLength(2);
		expect(scope.diagnostics[0]?.message).toContain('Model "vendor/fixture/model" is unavailable');
	});

	it("preserves literal colon IDs before parsing one thinking suffix", async () => {
		await catalog(["fixture/model", "fixture/model:free", "fixture/model:high", "fixture/model:free:high"]);
		expect(resolve("openrouter/fixture/model:high").thinkingLevel).toBeUndefined();
		expect(resolve("openrouter/fixture/model:high").model?.id).toBe("fixture/model:high");
		expect(resolve("openrouter/fixture/model:free:high").model?.id).toBe("fixture/model:free:high");
		expect(resolve("openrouter/fixture/model:free:high:low")).toMatchObject({
			model: { id: "fixture/model:free:high" },
			thinkingLevel: "low",
		});
		expect(resolve("openrouter/fixture/model:low:high").model).toBeUndefined();
	});

	it("preserves literal brackets and colon suffixes in automation scopes", async () => {
		const faux = await catalog(["fixture/model[1m]", "fixture/model[1m]:high"]);
		const scope = resolveModelScopeFromModels(["openrouter/fixture/model[1m]:high"], faux.models);
		expect(scope.scopedModels).toMatchObject([{ model: { id: "fixture/model[1m]:high" }, thinkingLevel: undefined }]);
		expect(scope.diagnostics).toEqual([]);
	});

	it("uses an explicit models.json definition's own capabilities and pricing", async () => {
		await catalog(["fixture/model:free"]);
		const defined = await createHarness({
			modelsJson: {
				providers: {
					openrouter: {
						api: "openai-completions",
						baseUrl: "https://example.invalid/v1",
						apiKey: "faux-key",
						models: [
							{
								id: "fixture/model",
								name: "Explicit base",
								reasoning: true,
								input: ["text", "image"],
								cost: { input: 2, output: 8, cacheRead: 1, cacheWrite: 2 },
								contextWindow: 64000,
								maxTokens: 4000,
							},
						],
					},
				},
			},
		});
		cleanups.push(defined.cleanup);
		const result = resolveCliModel({
			cliProvider: "openrouter",
			cliModel: "fixture/model",
			modelRuntime: defined.session.modelRuntime,
		});
		expect(result.model).toMatchObject({
			id: "fixture/model",
			name: "Explicit base",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 2, output: 8 },
			contextWindow: 64000,
			maxTokens: 4000,
		});
	});

	it("propagates an explicit initial-model error and rejects unavailable saved defaults", async () => {
		await catalog(["fixture/model:free"]);
		await expect(
			findInitialModel({
				cliModel: "openrouter/fixture/model",
				scopedModels: [],
				isContinuing: false,
				strictModelSelection: true,
				modelRuntime: harness.session.modelRuntime,
			}),
		).rejects.toThrow("not found");
		harness.settingsManager.setDefaultModelAndProvider("openrouter", "fixture/model");
		await expect(
			createAgentSession({
				cwd: harness.tempDir,
				agentDir: harness.tempDir,
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: createTestResourceLoader(),
				sessionManager: SessionManager.inMemory(harness.tempDir),
				strictModelSelection: true,
			}),
		).rejects.toThrow("Could not select default model openrouter/fixture/model");
	});

	it("restores model-only sessions exactly and rejects a missing saved base", async () => {
		await catalog(["fixture/model:free"]);
		for (const id of ["fixture/model:free", "fixture/model"]) {
			const manager = SessionManager.inMemory(harness.tempDir);
			manager.appendModelChange("openrouter", id);
			const result = createAgentSession({
				cwd: harness.tempDir,
				agentDir: harness.tempDir,
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: createTestResourceLoader(),
				sessionManager: manager,
				strictModelSelection: true,
			});
			if (id.endsWith(":free")) {
				const { session } = await result;
				cleanups.push(() => session.dispose());
				expect(session.model?.id).toBe(id);
			} else {
				await expect(result).rejects.toThrow("Could not restore model openrouter/fixture/model");
			}
		}
	});

	it("selects new and resumed sessions exactly and keeps the current session after model errors", async () => {
		const faux = await catalog(["fixture/model", "fixture/model:free"]);
		harness.settingsManager.setDefaultModelAndProvider("openrouter", "fixture/model");
		const factory: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			agentDir,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = {
				cwd,
				agentDir,
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: createTestResourceLoader(),
				diagnostics: [],
			};
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					strictModelSelection: true,
				})),
				services,
				diagnostics: [],
			};
		};
		const runtime = await createAgentSessionRuntime(factory, {
			cwd: harness.tempDir,
			agentDir: harness.tempDir,
			sessionManager: SessionManager.inMemory(harness.tempDir),
		});
		cleanups.push(() => runtime.dispose());
		const saved = SessionManager.create(harness.tempDir, join(harness.tempDir, "sessions"));
		saved.appendModelChange("openrouter", "fixture/model:free");
		saved.appendMessage({ ...fauxAssistantMessage("saved"), provider: "openrouter", model: "fixture/model:free" });
		await runtime.switchSession(saved.getSessionFile()!);
		expect(runtime.session.model?.id).toBe("fixture/model:free");
		await runtime.newSession();
		expect(runtime.session.model?.id).toBe("fixture/model");
		const current = runtime.session;
		const missing = SessionManager.create(harness.tempDir, join(harness.tempDir, "sessions"));
		missing.appendModelChange("openrouter", "fixture/missing");
		missing.appendMessage({ ...fauxAssistantMessage("missing"), provider: "openrouter", model: "fixture/missing" });
		await expect(runtime.switchSession(missing.getSessionFile()!)).rejects.toThrow("Could not restore model");
		expect(runtime.session).toBe(current);
		harness.settingsManager.setDefaultModelAndProvider("openrouter", "fixture/missing");
		await expect(runtime.newSession()).rejects.toThrow("Could not select default model");
		expect(runtime.session).toBe(current);
		faux.setResponses([fauxAssistantMessage("still usable")]);
		await runtime.session.prompt("after rejected selection");
		expect(runtime.session.getLastAssistantText()).toBe("still usable");
	});
});
