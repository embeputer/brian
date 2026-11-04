import { createA2aServer } from "@brian-agent/a2a";
import { createCodingAgentHarnessRunnerFactory } from "./harness-runner.ts";

export interface RunA2aServerOptions {
	baseUrl: string;
	port: number;
	host?: string;
	cwd?: string;
	agentDir?: string;
	name?: string;
	description?: string;
	token?: string;
}

export async function runA2aServer(
	options: RunA2aServerOptions,
): Promise<{ token: string; close: () => Promise<void> }> {
	const runnerFactory = await createCodingAgentHarnessRunnerFactory({
		cwd: options.cwd,
		agentDir: options.agentDir,
	});
	const server = await createA2aServer({
		baseUrl: options.baseUrl,
		runnerFactory,
		name: options.name,
		description: options.description,
		...(options.token ? { token: options.token } : {}),
	});
	await server.listen(options.port, options.host ?? "127.0.0.1");
	return {
		token: server.token,
		close: () => server.close(),
	};
}
