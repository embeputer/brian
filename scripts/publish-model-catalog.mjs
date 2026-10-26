#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

// Writes the static catalog that brian reads from the `model-catalog` branch:
//   v1/catalog.json               publication metadata (revision, counts, generatedAt)
//   v1/providers/<id>.json        { generatedAt, revision, models } with models of every type
// Bump CATALOG_SCHEMA_VERSION (and REMOTE_CATALOG_SCHEMA_VERSION in
// packages/coding-agent/src/core/remote-catalog-provider.ts) only when older brian clients
// cannot read the generated model metadata; they keep reading the previous directory.
const CATALOG_SCHEMA_VERSION = 1;
const REQUIRED_PROVIDERS = ["anthropic", "openai", "openrouter"];
const MINIMUM_MODEL_COUNT = 500;
const MODEL_TYPES = ["chat", "image", "classifier"];

function parseArgs(args) {
	const options = {
		input: undefined,
		output: undefined,
		sourceCommit: undefined,
		dryRun: false,
	};

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		if (arg === "--input" || arg === "--output" || arg === "--source-commit") {
			const value = args[++index];
			if (!value) throw new Error(`${arg} requires a value`);
			options[
				{
					"--input": "input",
					"--output": "output",
					"--source-commit": "sourceCommit",
				}[arg]
			] = value;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	if (!options.input) throw new Error("--input is required");
	if (!options.dryRun && !options.output) throw new Error("--output is required when publishing");
	return options;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chatProjection(providerModels) {
	return Object.fromEntries(providerModels.filter((model) => model.type === "chat").map((model) => [model.id, model]));
}

function validateBundle(inputDir) {
	const modelsPath = join(inputDir, "models.json");
	const allModelsPath = join(inputDir, "models.all.json");
	const providerIndexPath = join(inputDir, "providers.json");
	const providersDir = join(inputDir, "providers");
	const modelsBytes = readFileSync(modelsPath);
	const allModelsBytes = readFileSync(allModelsPath);
	const models = JSON.parse(modelsBytes.toString("utf8"));
	const allModels = JSON.parse(allModelsBytes.toString("utf8"));
	const providerIds = readJson(providerIndexPath);

	if (!isObject(models)) throw new Error("models.json must contain an object");
	if (!isObject(allModels)) throw new Error("models.all.json must contain an object");
	if (!Array.isArray(providerIds) || !providerIds.every((value) => typeof value === "string")) {
		throw new Error("providers.json must contain an array of provider IDs");
	}

	const expectedProviderIds = Object.keys(allModels).sort();
	if (!isDeepStrictEqual(providerIds, expectedProviderIds)) {
		throw new Error("providers.json does not match the sorted providers in models.all.json");
	}
	if (!isDeepStrictEqual(Object.keys(models).sort(), expectedProviderIds)) {
		throw new Error("models.json and models.all.json list different providers");
	}
	for (const providerId of REQUIRED_PROVIDERS) {
		if (!Object.hasOwn(models, providerId)) throw new Error(`Required provider is missing: ${providerId}`);
	}

	// modelCount remains the legacy chat-catalog count for existing consumers.
	let modelCount = 0;
	let imageModelCount = 0;
	let classifierModelCount = 0;
	for (const providerId of providerIds) {
		const providerModels = allModels[providerId];
		if (!Array.isArray(providerModels)) throw new Error(`Full provider catalog must be an array: ${providerId}`);
		const providerFile = readJson(join(providersDir, `${providerId}.all.json`));
		if (!isDeepStrictEqual(providerFile, providerModels)) {
			throw new Error(`Provider shard does not match models.all.json: ${providerId}`);
		}
		const identities = new Set();
		for (const model of providerModels) {
			if (!isObject(model) || typeof model.id !== "string" || model.provider !== providerId) {
				throw new Error(`Invalid model entry in provider catalog: ${providerId}`);
			}
			if (!MODEL_TYPES.includes(model.type)) {
				throw new Error(`Model entry has an unknown type: ${providerId}/${model.id} (${JSON.stringify(model.type)})`);
			}
			const identity = `${model.type}:${model.id}`;
			if (identities.has(identity)) throw new Error(`Duplicate model entry: ${providerId}/${identity}`);
			identities.add(identity);
			if (model.type === "chat") modelCount++;
			else if (model.type === "image") imageModelCount++;
			else classifierModelCount++;
		}

		// The legacy variant must be exactly the chat projection of the full catalog.
		const chatModels = chatProjection(providerModels);
		if (!isDeepStrictEqual(models[providerId], chatModels)) {
			throw new Error(`models.json is not the chat projection of models.all.json: ${providerId}`);
		}
		if (!isDeepStrictEqual(readJson(join(providersDir, `${providerId}.json`)), chatModels)) {
			throw new Error(`Provider shard does not match models.json: ${providerId}`);
		}
	}

	const shardFiles = readdirSync(providersDir).filter((name) => name.endsWith(".json")).sort();
	const expectedShardFiles = providerIds.flatMap((providerId) => [`${providerId}.json`, `${providerId}.all.json`]).sort();
	if (!isDeepStrictEqual(shardFiles, expectedShardFiles)) {
		throw new Error("Provider shard files do not match providers.json");
	}
	if (modelCount < MINIMUM_MODEL_COUNT) {
		throw new Error(`Refusing to publish only ${modelCount} models; expected at least ${MINIMUM_MODEL_COUNT}`);
	}

	// The full catalog is a superset of the chat catalog, so hashing it alone
	// changes the revision for chat-only and image-only updates alike.
	const digest = createHash("sha256").update(allModelsBytes).digest("hex");
	return {
		modelsPath,
		allModelsPath,
		providerIndexPath,
		providersDir,
		providerIds,
		providerCount: providerIds.length,
		modelCount,
		chatModelCount: modelCount,
		imageModelCount,
		classifierModelCount,
		totalModelCount: modelCount + imageModelCount + classifierModelCount,
		revision: `sha256-${digest}`,
	};
}

function gitSourceCommit() {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`Unable to determine source commit: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const inputDir = resolve(options.input);
	const bundle = validateBundle(inputDir);
	const generatedAt = new Date().toISOString();
	const publication = {
		schemaVersion: CATALOG_SCHEMA_VERSION,
		revision: bundle.revision,
		generatedAt,
		sourceCommit: options.sourceCommit || gitSourceCommit(),
		providerCount: bundle.providerCount,
		/** Legacy count for the chat-only `models.json` catalog. */
		modelCount: bundle.modelCount,
		chatModelCount: bundle.chatModelCount,
		imageModelCount: bundle.imageModelCount,
		classifierModelCount: bundle.classifierModelCount,
		totalModelCount: bundle.totalModelCount,
		modelTypes: MODEL_TYPES,
	};
	writeFileSync(join(inputDir, "publication.json"), `${JSON.stringify(publication, null, 2)}\n`);

	console.log(JSON.stringify(publication, null, 2));
	if (options.dryRun) {
		console.log(`Validated model catalog at ${inputDir}; nothing written.`);
		return;
	}

	const versionDir = join(resolve(options.output), `v${CATALOG_SCHEMA_VERSION}`);
	const currentPath = join(versionDir, "catalog.json");
	if (existsSync(currentPath) && readJson(currentPath).revision === bundle.revision) {
		console.log(`Model catalog ${bundle.revision} is already current; nothing written.`);
		return;
	}
	rmSync(versionDir, { recursive: true, force: true });
	const providersDir = join(versionDir, "providers");
	mkdirSync(providersDir, { recursive: true });
	for (const providerId of bundle.providerIds) {
		const models = readJson(join(bundle.providersDir, `${providerId}.all.json`));
		writeFileSync(
			join(providersDir, `${providerId}.json`),
			`${JSON.stringify({ generatedAt, revision: bundle.revision, models })}\n`,
		);
	}
	writeFileSync(currentPath, `${JSON.stringify(publication, null, 2)}\n`);
	console.log(`Wrote model catalog ${bundle.revision} to ${versionDir}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
