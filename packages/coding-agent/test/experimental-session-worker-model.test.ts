import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TODO_CONTEXT } from "@punch-bot/chord/context";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { sessionStoragePath } from "../src/experimental/session-catalog.ts";
import { createCodingAgentHarness, type SessionWorkerOptions } from "../src/experimental/session-worker.ts";
import { createExperimentalSessions } from "./experimental-session-support.ts";

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

test("requested model replaces the saved root conversation model", async () => {
	const sessionsRoot = join(root, "sessions");
	const cwd = join(root, "cwd");
	await mkdir(cwd, { recursive: true });
	const [metadata] = await createExperimentalSessions(sessionsRoot, ["session-1"], cwd);
	const options: SessionWorkerOptions = {
		sessionDir: sessionsRoot,
		metadata,
		provider: "openrouter",
		model: "fixture/model:free",
		pluginManifestPaths: [],
	};
	const seeded = await createCodingAgentHarness(sessionStoragePath(metadata), options);
	await seeded.harness.close(TODO_CONTEXT);
	await seeded.cleanup?.(TODO_CONTEXT);

	const runtime = await createCodingAgentHarness(sessionStoragePath(metadata), { ...options, model: "fixture/model" });
	try {
		expect((await runtime.conversation.agent(TODO_CONTEXT)).model).toEqual({
			provider: "openrouter",
			modelId: "fixture/model",
		});
	} finally {
		await runtime.harness.close(TODO_CONTEXT);
		await runtime.cleanup?.(TODO_CONTEXT);
	}
});
