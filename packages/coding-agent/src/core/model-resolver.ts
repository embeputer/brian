/**
 * Model resolution, scoping, and initial selection
 */

import type { ThinkingLevel } from "@punch-bot/agent";
import { type Api, type AuthOperationOptions, type KnownProvider, type Model, modelsAreEqual } from "@punch-bot/ai";
import chalk from "chalk";
import { minimatch } from "minimatch";
import { isValidThinkingLevel } from "../cli/args.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type { ModelRuntime } from "./model-runtime.ts";

/** Default model IDs for each known provider */
export const defaultModelPerProvider: Record<KnownProvider, string> = {
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	"ant-ling": "Ring-2.6-1T",
	anthropic: "claude-opus-4-8",
	openai: "gpt-5.5",
	"azure-openai-responses": "gpt-5.4",
	"openai-codex": "gpt-5.5",
	radius: "balanced",
	nvidia: "nvidia/nemotron-3-super-120b-a12b",
	deepseek: "deepseek-v4-pro",
	google: "gemini-3.1-pro-preview",
	"google-vertex": "gemini-3.1-pro-preview",
	"github-copilot": "gpt-5.4",
	openrouter: "moonshotai/kimi-k2.6",
	"vercel-ai-gateway": "zai/glm-5.1",
	xai: "grok-4.6",
	groq: "openai/gpt-oss-120b",
	cerebras: "gpt-oss-120b",
	zai: "glm-5.3",
	"zai-coding-cn": "glm-5.3",
	mistral: "devstral-medium-latest",
	minimax: "MiniMax-M2.7",
	"minimax-cn": "MiniMax-M2.7",
	moonshotai: "kimi-k2.6",
	"moonshotai-cn": "kimi-k2.6",
	huggingface: "moonshotai/Kimi-K2.6",
	fireworks: "accounts/fireworks/models/kimi-k2p6",
	together: "moonshotai/Kimi-K2.6",
	baseten: "zai-org/GLM-5.2",
	opencode: "kimi-k2.6",
	"opencode-go": "kimi-k2.6",
	"kimi-coding": "kimi-for-coding",
	"cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.6",
	"cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.6",
	"qwen-token-plan": "qwen3.7-max",
	"qwen-token-plan-cn": "qwen3.7-max",
	"qwen-token-plan-individual": "qwen3.8-max",
	xiaomi: "mimo-v2.5-pro",
	"xiaomi-token-plan-cn": "mimo-v2.5-pro",
	"xiaomi-token-plan-ams": "mimo-v2.5-pro",
	"xiaomi-token-plan-sgp": "mimo-v2.5-pro",
};

export interface ScopedModel {
	model: Model<Api>;
	/** Thinking level if explicitly specified in pattern (e.g., "model:high"), undefined otherwise */
	thinkingLevel?: ThinkingLevel;
}

/**
 * Resolve model patterns to Model objects with optional thinking levels.
 * Format: "<id>:<level>" where :level is optional.
 *
 * Plain patterns must name one catalog model exactly (see resolveCliModel).
 * Patterns containing *, ?, or [ are globs over "provider/id", or also over the
 * bare ID when the glob does not start with a provider name. A literal catalog
 * ID containing those characters still resolves exactly.
 */
export interface ModelScopeDiagnostic {
	type: "warning";
	code: "no-match";
	message: string;
	pattern: string;
}

export interface ResolveModelScopeResult {
	scopedModels: ScopedModel[];
	diagnostics: ModelScopeDiagnostic[];
}

export function resolveModelScopeFromModels(
	patterns: string[],
	models: readonly Model<Api>[],
	options?: { catalogModels?: readonly Model<Api>[] },
): ResolveModelScopeResult {
	const availableModels = [...models];
	const catalogModels = options?.catalogModels ?? availableModels;
	const providers = new Set(catalogModels.map((model) => model.provider.toLowerCase()));
	const scopedModels: ScopedModel[] = [];
	const diagnostics: ModelScopeDiagnostic[] = [];
	const addModel = (model: Model<Api>, thinkingLevel: ThinkingLevel | undefined) => {
		if (!scopedModels.find((sm) => modelsAreEqual(sm.model, model))) {
			scopedModels.push({ model, thinkingLevel });
		}
	};

	for (const pattern of patterns) {
		const exact = resolveExactModelReference(pattern, catalogModels);
		// An ambiguous literal ID is reported as-is and never retried as a glob.
		if (
			!exact.model &&
			!exact.ambiguous &&
			(pattern.includes("*") || pattern.includes("?") || pattern.includes("["))
		) {
			// Extract optional thinking level suffix (e.g., "provider/*:high")
			const colonIdx = pattern.lastIndexOf(":");
			let globPattern = pattern;
			let thinkingLevel: ThinkingLevel | undefined;
			if (colonIdx !== -1) {
				const suffix = pattern.substring(colonIdx + 1);
				if (isValidThinkingLevel(suffix)) {
					thinkingLevel = suffix;
					globPattern = pattern.substring(0, colonIdx);
				}
			}

			// "*sonnet*" matches bare IDs, but "openrouter/*" only matches that provider.
			const matchFullIdOnly = providers.has(globPattern.split("/")[0].toLowerCase());
			const matchingModels = availableModels.filter(
				(m) =>
					minimatch(`${m.provider}/${m.id}`, globPattern, { nocase: true }) ||
					(!matchFullIdOnly && minimatch(m.id, globPattern, { nocase: true })),
			);
			if (matchingModels.length === 0) {
				diagnostics.push({
					type: "warning",
					code: "no-match",
					message: `No models match pattern "${pattern}"`,
					pattern,
				});
			}
			for (const model of matchingModels) addModel(model, thinkingLevel);
			continue;
		}

		const model = exact.model;
		if (!model) {
			diagnostics.push({ type: "warning", code: "no-match", message: exact.error ?? "", pattern });
			continue;
		}
		if (!availableModels.some((available) => modelsAreEqual(available, model))) {
			diagnostics.push({
				type: "warning",
				code: "no-match",
				message: `Model "${model.provider}/${model.id}" is unavailable. Configure authentication for its provider.`,
				pattern,
			});
			continue;
		}
		addModel(model, exact.thinkingLevel);
	}

	return { scopedModels, diagnostics };
}

export async function resolveModelScopeWithDiagnostics(
	patterns: string[],
	modelRuntime: ModelRuntime,
	options?: AuthOperationOptions,
): Promise<ResolveModelScopeResult> {
	return resolveModelScopeFromModels(patterns, await modelRuntime.getAvailable(undefined, options), {
		// Authentication must not change provider inference or hide ambiguous IDs.
		catalogModels: modelRuntime.getModels(),
	});
}

export interface ResolveCliModelResult {
	model: Model<Api> | undefined;
	thinkingLevel?: ThinkingLevel;
	warning: string | undefined;
	/**
	 * Error message suitable for CLI display.
	 * When set, model will be undefined.
	 */
	error: string | undefined;
}

/** Internal result. `ambiguous` is set when several catalog models match the reference. */
interface ExactModelResolution extends ResolveCliModelResult {
	ambiguous?: boolean;
}

function resolveExactModelReference(
	reference: string,
	models: readonly Model<Api>[],
	cliProvider?: string,
): ExactModelResolution {
	const providerNames = [...new Set(models.map((model) => model.provider))];
	// An exact-case provider wins; otherwise a case-insensitive match must be unique.
	const matchProvider = (name: string) => {
		const exact = providerNames.filter((provider) => provider === name);
		return exact.length > 0
			? exact
			: providerNames.filter((provider) => provider.toLowerCase() === name.toLowerCase());
	};
	const cliMatches = cliProvider === undefined ? [] : matchProvider(cliProvider);
	if (cliProvider !== undefined && cliMatches.length === 0) {
		return {
			model: undefined,
			warning: undefined,
			error: `Unknown provider "${cliProvider}". Use --list-models to see available providers.`,
		};
	}
	if (cliProvider !== undefined && cliMatches.length > 1) {
		return {
			model: undefined,
			warning: undefined,
			error: `Provider "${cliProvider}" is ambiguous: ${cliMatches.sort().join(", ")}.`,
		};
	}
	let provider: string | undefined = cliMatches.length === 1 ? cliMatches[0] : undefined;
	let modelId = reference;
	const literalId = cliProvider === undefined ? undefined : reference;
	if (provider === undefined) {
		const slash = modelId.indexOf("/");
		// An ambiguous prefix is not a provider; it stays part of the model ID.
		const prefixMatches = slash === -1 ? [] : matchProvider(modelId.slice(0, slash));
		if (prefixMatches.length === 1) {
			provider = prefixMatches[0];
			modelId = modelId.slice(slash + 1);
		}
	} else if (modelId.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) {
		modelId = modelId.slice(provider.length + 1);
	}

	const candidates = provider === undefined ? models : models.filter((model) => model.provider === provider);
	// An exact-case ID wins; otherwise accept IDs that differ only in case.
	const findMatches = (id: string) => {
		const matches = candidates.filter((model) => model.id === id);
		return matches.length > 0 ? matches : candidates.filter((model) => model.id.toLowerCase() === id.toLowerCase());
	};
	// With --provider, the raw ID may itself start with that provider name
	// (for example OpenRouter's openrouter/fusion).
	const ids = literalId === undefined || literalId === modelId ? [modelId] : [literalId, modelId];
	let matches = ids.map(findMatches).find((matches) => matches.length > 0) ?? [];
	let thinkingLevel: ThinkingLevel | undefined;
	// A literal catalog ID takes precedence, including IDs ending in :high.
	// Strip at most one thinking suffix, and only resolve the remaining ID exactly.
	if (matches.length === 0) {
		for (const id of ids) {
			const colon = id.lastIndexOf(":");
			const suffix = id.slice(colon + 1);
			if (colon !== -1 && isValidThinkingLevel(suffix)) {
				matches = findMatches(id.slice(0, colon));
				if (matches.length > 0) {
					thinkingLevel = suffix;
					break;
				}
			}
		}
	}
	if (matches.length === 1) {
		return { model: matches[0], thinkingLevel, warning: undefined, error: undefined };
	}
	const display = provider === undefined ? reference : `${provider}/${modelId}`;
	return {
		model: undefined,
		warning: undefined,
		ambiguous: matches.length > 1,
		error:
			matches.length > 1
				? `Model "${display}" is ambiguous: ${matches
						.map((model) => `${model.provider}/${model.id}`)
						.sort()
						.join(", ")}. Use --provider or provider/model.`
				: `Model "${display}" not found. Use --list-models or define the exact model in models.json.`,
	};
}

/**
 * Resolve a single model from CLI flags.
 *
 * Supports:
 * - --provider <provider> --model <id>
 * - --model <provider>/<id>
 *
 * The ID must name one catalog model exactly. Case is ignored only when that
 * leaves a single match. There is no partial matching or custom-model fallback.
 *
 * Note: This does not apply the thinking level by itself, but it may *parse* and
 * return a thinking level from "<id>:<thinking>" so the caller can apply it.
 */
export function resolveCliModel(options: {
	cliProvider?: string;
	cliModel?: string;
	modelRuntime: ModelRuntime;
}): ResolveCliModelResult {
	const { cliProvider, cliModel, modelRuntime } = options;
	if (cliModel === undefined) {
		return { model: undefined, warning: undefined, error: undefined };
	}
	// Use all models, not only authenticated ones, so --api-key works for first-time setup.
	const resolved = resolveExactModelReference(cliModel, modelRuntime.getModels(), cliProvider);
	// Copy fields explicitly so the internal `ambiguous` flag does not leak.
	return {
		model: resolved.model,
		thinkingLevel: resolved.thinkingLevel,
		warning: resolved.warning,
		error: resolved.error,
	};
}

export interface InitialModelResult {
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
	fallbackMessage: string | undefined;
}

/**
 * Find the initial model to use based on priority:
 * 1. CLI args (provider + model)
 * 2. First model from scoped models (if not continuing/resuming)
 * 3. Restored from session (if continuing/resuming)
 * 4. Saved default from settings
 * 5. First available model with valid API key
 */
export async function findInitialModel(options: {
	cliProvider?: string;
	cliModel?: string;
	scopedModels: ScopedModel[];
	isContinuing: boolean;
	defaultProvider?: string;
	defaultModelId?: string;
	defaultThinkingLevel?: ThinkingLevel;
	modelThinkingLevels?: Record<string, ThinkingLevel>;
	strictModelSelection?: boolean;
	modelRuntime: ModelRuntime;
}): Promise<InitialModelResult> {
	const {
		cliProvider,
		cliModel,
		scopedModels,
		isContinuing,
		defaultProvider,
		defaultModelId,
		defaultThinkingLevel,
		modelThinkingLevels,
		modelRuntime,
		strictModelSelection = true,
	} = options;

	let model: Model<Api> | undefined;
	let thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL;

	// 1. CLI args take priority
	if (cliModel !== undefined) {
		const resolved = resolveCliModel({
			cliProvider,
			cliModel,
			modelRuntime,
		});
		if (resolved.error) {
			if (strictModelSelection) throw new Error(resolved.error);
			console.error(chalk.red(resolved.error));
			process.exit(1);
		}
		if (resolved.model) {
			return {
				model: resolved.model,
				thinkingLevel: resolved.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
				fallbackMessage: undefined,
			};
		}
	}

	// 2. Use first model from scoped models (skip if continuing/resuming)
	if (scopedModels.length > 0 && !isContinuing) {
		const scopedModel = scopedModels[0];
		const perModel = modelThinkingLevels?.[`${scopedModel.model.provider}/${scopedModel.model.id}`];
		return {
			model: scopedModel.model,
			thinkingLevel: scopedModel.thinkingLevel ?? perModel ?? defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL,
			fallbackMessage: undefined,
		};
	}

	// 3. Try saved default from settings if auth is configured.
	if (defaultProvider && defaultModelId) {
		const found = modelRuntime.getModel(defaultProvider, defaultModelId);
		if (strictModelSelection && (!found || !modelRuntime.hasConfiguredAuth(defaultProvider))) {
			throw new Error(
				`Could not select default model ${defaultProvider}/${defaultModelId}: ${found ? "no auth configured" : "model not found; define the exact model in models.json"}.`,
			);
		}
		if (found && modelRuntime.hasConfiguredAuth(found.provider)) {
			model = found;
			const perModel = modelThinkingLevels?.[`${defaultProvider}/${defaultModelId}`];
			if (perModel) {
				thinkingLevel = perModel;
			} else if (defaultThinkingLevel) {
				thinkingLevel = defaultThinkingLevel;
			}
			return { model, thinkingLevel, fallbackMessage: undefined };
		}
	}

	// 4. Try first available model with valid API key
	const availableModels = [...modelRuntime.getAvailableSnapshot()];

	if (availableModels.length > 0) {
		// Try to find a default model from known providers
		for (const provider of Object.keys(defaultModelPerProvider) as KnownProvider[]) {
			const defaultId = defaultModelPerProvider[provider];
			const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
			if (match) {
				return { model: match, thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
			}
		}

		// If no default found, use first available
		return { model: availableModels[0], thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
	}

	// 5. No model found
	return { model: undefined, thinkingLevel: DEFAULT_THINKING_LEVEL, fallbackMessage: undefined };
}

/**
 * Restore model from session, with fallback to available models
 */
export async function restoreModelFromSession(
	savedProvider: string,
	savedModelId: string,
	currentModel: Model<Api> | undefined,
	shouldPrintMessages: boolean,
	modelRuntime: ModelRuntime,
): Promise<{ model: Model<Api> | undefined; fallbackMessage: string | undefined }> {
	const restoredModel = modelRuntime.getModel(savedProvider, savedModelId);

	// Check if restored model exists and still has auth configured
	const hasConfiguredAuth = restoredModel ? modelRuntime.hasConfiguredAuth(restoredModel.provider) : false;

	if (restoredModel && hasConfiguredAuth) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
		}
		return { model: restoredModel, fallbackMessage: undefined };
	}

	// Model not found or no API key - fall back
	const reason = !restoredModel ? "model no longer exists" : "no auth configured";

	if (shouldPrintMessages) {
		console.error(chalk.yellow(`Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`));
	}

	// If we already have a model, use it as fallback
	if (currentModel) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${currentModel.provider}/${currentModel.id}`));
		}
		return {
			model: currentModel,
			fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${currentModel.provider}/${currentModel.id}.`,
		};
	}

	// Try to find any available model
	const availableModels = [...modelRuntime.getAvailableSnapshot()];

	if (availableModels.length > 0) {
		// Try to find a default model from known providers
		let fallbackModel: Model<Api> | undefined;
		for (const provider of Object.keys(defaultModelPerProvider) as KnownProvider[]) {
			const defaultId = defaultModelPerProvider[provider];
			const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
			if (match) {
				fallbackModel = match;
				break;
			}
		}

		// If no default found, use first available
		if (!fallbackModel) {
			fallbackModel = availableModels[0];
		}

		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${fallbackModel.provider}/${fallbackModel.id}`));
		}

		return {
			model: fallbackModel,
			fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${fallbackModel.provider}/${fallbackModel.id}.`,
		};
	}

	// No models available
	return { model: undefined, fallbackMessage: undefined };
}
