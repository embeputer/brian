/**
 * OpenRouter routing variants: model ID suffixes that change only how OpenRouter routes a request.
 *
 * OpenRouter accepts these on any model ID, so they are not catalog entries. Catalog variants such as
 * `:free` and `:batch` are separate catalog IDs and resolve exactly like any other ID.
 * See https://openrouter.ai/docs/guides/routing/model-variants
 */

import type { Api, Model } from "@punch-bot/ai";

/** `:online` is deprecated by OpenRouter but still accepted. */
export const OPENROUTER_ROUTING_SUFFIXES: readonly string[] = ["exacto", "floor", "nitro", "online"];

/**
 * Resolve `<catalog id>:<suffix>[:<suffix>...]` for provider `openrouter`, where every suffix is a
 * distinct entry of OPENROUTER_ROUTING_SUFFIXES and `findBase` resolves the remaining catalog ID.
 * Returns a copy of the base model whose ID keeps the suffixes, so they reach OpenRouter verbatim.
 * Returns undefined for other providers, unknown or repeated suffixes, and unknown base IDs.
 */
export function resolveOpenRouterRoutingVariant(
	provider: string,
	modelId: string,
	findBase: (baseId: string) => Model<Api> | undefined,
): Model<Api> | undefined {
	if (provider !== "openrouter") return undefined;
	const suffixes: string[] = [];
	let baseId = modelId;
	for (;;) {
		const colon = baseId.lastIndexOf(":");
		if (colon === -1) return undefined;
		const suffix = baseId.slice(colon + 1);
		if (!OPENROUTER_ROUTING_SUFFIXES.includes(suffix) || suffixes.includes(suffix)) return undefined;
		suffixes.unshift(suffix);
		baseId = baseId.slice(0, colon);
		const base = findBase(baseId);
		if (base?.provider === provider) {
			return { ...base, id: `${base.id}:${suffixes.join(":")}`, name: `${base.name} (${suffixes.join(", ")})` };
		}
	}
}
