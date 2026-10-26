import { randomUUID } from "node:crypto";

import { createA2aServer, type LocalA2aDiscovery } from "@brian-agent/a2a";

import { createCodingAgentHarnessRunnerFactory } from "../../server/a2a/harness-runner.ts";
import { brianA2aDiscovery, brianSandboxName } from "./a2a.ts";

const HEARTBEAT_MS = 15_000;

interface ProcessA2a {
	discovery: LocalA2aDiscovery;
	close(): Promise<void>;
}

let processA2a: ProcessA2a | undefined;
let processA2aStart: Promise<ProcessA2a | undefined> | undefined;

function parseListenPort(env: NodeJS.ProcessEnv): number {
	if (!env.BRIAN_A2A_PORT) return 0;
	const port = Number(env.BRIAN_A2A_PORT);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new Error(`Invalid BRIAN_A2A_PORT "${env.BRIAN_A2A_PORT}"`);
	}
	return port;
}

export async function startBrianA2aListener(
	env: NodeJS.ProcessEnv = process.env,
	discovery?: LocalA2aDiscovery,
): Promise<ProcessA2a | undefined> {
	if (processA2a) return processA2a;
	if (processA2aStart) return processA2aStart;
	processA2aStart = (async () => {
		const registry = discovery ?? brianA2aDiscovery(env);
		const host = env.BRIAN_A2A_HOST || "127.0.0.1";
		const port = parseListenPort(env);
		const name = brianSandboxName(env);
		const advertiseUrl = env.BRIAN_A2A_ADVERTISE_URL?.trim();
		const publicHost = env.BRIAN_A2A_ADVERTISE_HOST?.trim();
		const runnerFactory = await createCodingAgentHarnessRunnerFactory({ cwd: process.cwd() });
		const server = await createA2aServer({
			runnerFactory,
			name,
			description: `Brian sandbox ${name}`,
			...(advertiseUrl ? { baseUrl: advertiseUrl } : {}),
			...(publicHost ? { publicHost } : {}),
		});
		try {
			const bound = await server.listen(port, host);
			server.unref();
			const url = advertiseUrl || bound.url;
			registry.advertise({
				id: randomUUID(),
				name,
				url,
				pid: process.pid,
				cwd: process.cwd(),
				startedAt: Date.now(),
			});
			const timer = setInterval(() => {
				try {
					registry.heartbeat();
				} catch (err) {
					console.warn(`brian a2a heartbeat failed: ${(err as Error).message}`);
				}
			}, HEARTBEAT_MS);
			timer.unref();
			const close = async () => {
				clearInterval(timer);
				registry.close();
				await server.close();
			};
			const runtime: ProcessA2a = { discovery: registry, close };
			processA2a = runtime;
			process.on("exit", () => {
				registry.close();
			});
			return runtime;
		} catch (err) {
			await server.close().catch(() => undefined);
			throw err;
		}
	})().catch((err) => {
		processA2aStart = undefined;
		console.warn(`brian a2a discovery disabled: ${(err as Error).message}`);
		return undefined;
	});
	return processA2aStart;
}

export async function stopBrianA2aListener(): Promise<void> {
	const pending = processA2aStart;
	processA2aStart = undefined;
	const runtime = processA2a ?? (await pending);
	processA2a = undefined;
	await runtime?.close();
}
