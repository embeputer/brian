import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function writeBundle(input) {
	const providersDir = join(input, "providers");
	mkdirSync(providersDir);

	const chatModels = Array.from({ length: 500 }, (_, index) => ({
		type: "chat",
		id: `chat-${index}`,
		provider: "anthropic",
	}));
	const allModels = {
		anthropic: chatModels,
		openai: [],
		openrouter: [
			{ type: "image", id: "shared", provider: "openrouter" },
			{ type: "classifier", id: "shared", provider: "openrouter" },
		],
	};
	const models = {
		anthropic: Object.fromEntries(chatModels.map((model) => [model.id, model])),
		openai: {},
		openrouter: {},
	};
	const providerIds = Object.keys(allModels).sort();
	writeJson(join(input, "models.json"), models);
	writeJson(join(input, "models.all.json"), allModels);
	writeJson(join(input, "providers.json"), providerIds);
	for (const providerId of providerIds) {
		writeJson(join(providersDir, `${providerId}.json`), models[providerId]);
		writeJson(join(providersDir, `${providerId}.all.json`), allModels[providerId]);
	}

}

test("publishes explicit per-type and total model counts", (t) => {
	const input = mkdtempSync(join(tmpdir(), "brian-model-catalog-counts-"));
	t.after(() => rmSync(input, { recursive: true, force: true }));
	writeBundle(input);

	const result = spawnSync(
		process.execPath,
		[
			"scripts/publish-model-catalog.mjs",
			"--input",
			input,
			"--source-commit",
			"test-commit",
			"--dry-run",
		],
		{ cwd: root, encoding: "utf8" },
	);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const publication = JSON.parse(readFileSync(join(input, "publication.json"), "utf8"));
	assert.equal(publication.modelCount, 500);
	assert.equal(publication.chatModelCount, 500);
	assert.equal(publication.imageModelCount, 1);
	assert.equal(publication.classifierModelCount, 1);
	assert.equal(publication.totalModelCount, 502);
});

test("writes per-provider shards with generatedAt and skips an unchanged revision", (t) => {
	const input = mkdtempSync(join(tmpdir(), "brian-model-catalog-input-"));
	const output = mkdtempSync(join(tmpdir(), "brian-model-catalog-output-"));
	t.after(() => {
		rmSync(input, { recursive: true, force: true });
		rmSync(output, { recursive: true, force: true });
	});
	writeBundle(input);
	const publish = () =>
		spawnSync(
			process.execPath,
			["scripts/publish-model-catalog.mjs", "--input", input, "--output", output, "--source-commit", "test-commit"],
			{ cwd: root, encoding: "utf8" },
		);

	const first = publish();
	assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
	const catalog = JSON.parse(readFileSync(join(output, "v1", "catalog.json"), "utf8"));
	const shard = JSON.parse(readFileSync(join(output, "v1", "providers", "openrouter.json"), "utf8"));
	assert.equal(shard.revision, catalog.revision);
	assert.equal(shard.generatedAt, catalog.generatedAt);
	assert.deepEqual(
		shard.models.map((model) => `${model.type}:${model.id}`),
		["image:shared", "classifier:shared"],
	);

	const second = publish();
	assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
	assert.match(second.stdout, /already current/);
	assert.equal(JSON.parse(readFileSync(join(output, "v1", "catalog.json"), "utf8")).generatedAt, catalog.generatedAt);
});
