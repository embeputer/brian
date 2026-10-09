import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentHarness, BACKGROUND_CONTEXT, JsonlSessionRepo, TODO_CONTEXT } from "@punch-bot/agent";
import { NodeExecutionEnv } from "@punch-bot/agent/node";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createCodingAgentHarness } from "../src/experimental/session-worker.ts";

const openrouter = {
	baseUrl: "https://openrouter.example.test/api/v1",
	apiKey: "test-key",
	api: "openai-completions",
	models: ["fixture/model", "fixture/model:free"].map((id) => ({
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 8000,
	})),
};

let root: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "punch-session-worker-model-"));
	previousAgentDir = process.env[ENV_AGENT_DIR];
	process.env[ENV_AGENT_DIR] = join(root, "agent");
	await mkdir(join(root, "agent"), { recursive: true });
	await writeFile(join(root, "agent", "models.json"), JSON.stringify({ providers: { openrouter } }));
});

afterEach(async () => {
	if (previousAgentDir === undefined) delete process.env[ENV_AGENT_DIR];
	else process.env[ENV_AGENT_DIR] = previousAgentDir;
	await rm(root, { recursive: true, force: true });
});

test("requested model replaces the saved main lane model", async () => {
	const sessionsRoot = join(root, "sessions");
	const cwd = join(root, "cwd");
	await mkdir(cwd, { recursive: true });
	const fileSystem = new NodeExecutionEnv({ cwd });
	const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot });
	try {
		const modelRuntime = await ModelRuntime.create();
		const free = modelRuntime.getModel("openrouter", "fixture/model:free");
		if (!free) throw new Error("Expected fixture model in catalog");
		const session = await repo.create({ id: "session-1", cwd }, BACKGROUND_CONTEXT);
		const seeded = await AgentHarness.create(
			{ session, models: modelRuntime, model: free, tools: [], resources: {} },
			BACKGROUND_CONTEXT,
		);
		await seeded.harness.close(BACKGROUND_CONTEXT);

		const metadata = session.metadata;
		const reopened = await repo.open(metadata, TODO_CONTEXT);
		const runtime = await createCodingAgentHarness(
			reopened,
			{
				sessionDir: sessionsRoot,
				metadata,
				provider: "openrouter",
				model: "fixture/model",
				pluginManifestPaths: [],
			},
			fileSystem,
		);
		try {
			const lane = runtime.lane;
			if (!lane) throw new Error("Expected main lane");
			expect((await lane.getModel(TODO_CONTEXT))?.id).toBe("fixture/model");
		} finally {
			await runtime.harness.close(TODO_CONTEXT);
		}
	} finally {
		await repo.close(BACKGROUND_CONTEXT);
		await fileSystem.cleanup(BACKGROUND_CONTEXT);
	}
});
