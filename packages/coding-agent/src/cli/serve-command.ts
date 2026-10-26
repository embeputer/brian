import chalk from "chalk";
import { APP_NAME } from "../config.ts";
import { BeeperClient, loadBeeperConfig } from "../core/messaging/beeper.ts";
import { type Decider, MessagingStore, pollMessages } from "../core/messaging/gateway.ts";
import { type Loop, loadServeConfig, type ServeConfig, startLoops, startServer } from "../core/serve.ts";
import {
	buildServicePlan,
	type CommandRunner,
	installService,
	removeService,
	runCommand,
	type ServicePlan,
	serviceState,
} from "../core/service.ts";
import { createProcessExecutor, type RoutineExecutor, runDueRoutines } from "../extensions/brian/routine-runner.ts";
import { RoutineStore } from "../extensions/brian/routines.ts";
import { createProcessDecider } from "./messages-command.ts";

const SERVE_HELP = `Usage: ${APP_NAME} serve [--port <n>] [--host <h>] [--no-routines] [--no-gateway]

Runs Brian in the foreground: routines (including the weekly audit), the messaging gateway
(when Beeper is connected), and a local API for apps. ${APP_NAME} wake runs this in the background.

API (token in ~/.brian/agent/serve.json, send as Authorization: Bearer <token>):
  GET  /v1/health            no auth
  GET  /v1/status
  POST /v1/prompt {prompt}   -> {text}`;

const WAKE_HELP = `Usage: ${APP_NAME} wake [--status]
       ${APP_NAME} sleep

wake   Install Brian as a background service that starts when you log in, and start it now
       (launchd on macOS, a systemd user service on Linux). Safe to re-run.
sleep  Stop the background service and remove it so it doesn't start at login.`;

export interface ServeDeps {
	executor?: RoutineExecutor;
	decide?: Decider;
	routines?: RoutineStore;
	messaging?: MessagingStore;
	config?: ServeConfig;
	beeperConfigFile?: string;
	signal?: AbortSignal;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const stamp = () => new Date().toISOString();

export async function runServe(args: string[], deps: ServeDeps = {}): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		console.log(SERVE_HELP);
		return 0;
	}
	const config = { ...(deps.config ?? loadServeConfig()) };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--port") config.port = Number(args[++i]);
		else if (args[i] === "--host") config.host = args[++i] ?? config.host;
	}
	if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
		console.error(chalk.red("Error: --port must be 0-65535"));
		return 1;
	}
	const executor = deps.executor ?? createProcessExecutor();
	const routines = deps.routines ?? new RoutineStore();
	const messaging = deps.messaging ?? new MessagingStore();
	let decide = deps.decide;
	const startedAt = stamp();
	const ticks: Record<string, string | null> = { routines: null, gateway: null };
	const errors: Record<string, string | null> = { routines: null, gateway: null };

	const loops: Loop[] = [];
	if (!args.includes("--no-routines"))
		loops.push({
			name: "routines",
			intervalMs: 30_000,
			async tick() {
				const { ran, failed } = await runDueRoutines(routines, executor);
				if (ran) console.log(`${stamp()} routines: ran ${ran}${failed ? `, ${failed} failed` : ""}`);
				ticks.routines = stamp();
			},
		});
	if (!args.includes("--no-gateway"))
		loops.push({
			name: "gateway",
			intervalMs: 30_000,
			async tick() {
				const beeper = loadBeeperConfig(deps.beeperConfigFile);
				if (!beeper) return;
				decide ??= createProcessDecider();
				const result = await pollMessages(new BeeperClient(beeper), messaging, decide);
				for (const d of result.drafts) console.log(`${stamp()} gateway: draft ${d.id} for ${d.chatTitle}`);
				if (result.sent) console.log(`${stamp()} gateway: sent ${result.sent}`);
				for (const e of result.errors) console.error(`${stamp()} gateway: ${e}`);
				ticks.gateway = stamp();
			},
		});

	const { server, url } = await startServer(config, {
		status: () => ({
			startedAt,
			loops: Object.fromEntries(loops.map((l) => [l.name, { lastTick: ticks[l.name], lastError: errors[l.name] }])),
			routines: routines.list().length,
			beeperConnected: Boolean(loadBeeperConfig(deps.beeperConfigFile)),
			pendingDrafts: messaging.pendingDrafts().length,
		}),
		prompt: (text) => executor.runTask(text),
	});
	console.log(`${APP_NAME} serve: listening on ${url} (${loops.map((l) => l.name).join(", ") || "no loops"})`);
	const stopLoops = startLoops(loops, (name, error) => {
		errors[name] = message(error);
		console.error(`${stamp()} ${name}: ${message(error)}`);
	});

	await new Promise<void>((resolve) => {
		const stop = () => resolve();
		deps.signal?.addEventListener("abort", stop, { once: true });
		if (!deps.signal) {
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		}
	});
	stopLoops();
	await new Promise((resolve) => server.close(resolve));
	return 0;
}

export interface WakeDeps {
	plan?: ServicePlan;
	run?: CommandRunner;
	config?: ServeConfig;
	fetch?: typeof fetch;
	waitMs?: number;
}

async function waitForHealth(url: string, fetchImpl: typeof fetch, waitMs: number): Promise<boolean> {
	const deadline = Date.now() + waitMs;
	do {
		try {
			if ((await fetchImpl(`${url}/v1/health`)).ok) return true;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 500));
	} while (Date.now() < deadline);
	return false;
}

function unsupported(): number {
	console.error(
		chalk.yellow(
			`Background service isn't supported on ${process.platform} yet. Run ${APP_NAME} serve in a terminal instead.`,
		),
	);
	return 1;
}

export async function runWake(args: string[], deps: WakeDeps = {}): Promise<number> {
	if (args.includes("--help") || args.includes("-h")) {
		console.log(WAKE_HELP);
		return 0;
	}
	const plan = deps.plan ?? buildServicePlan();
	if (!plan) return unsupported();
	const run = deps.run ?? runCommand;
	const config = deps.config ?? loadServeConfig();
	const url = `http://${config.host}:${config.port}`;
	if (args.includes("--status")) {
		console.log(`${APP_NAME}: ${serviceState(plan, run)} (${plan.kind}, ${plan.file})`);
		return 0;
	}
	try {
		installService(plan, run);
	} catch (error) {
		console.error(chalk.red(`Error: couldn't start the background service: ${message(error)}`));
		if (plan.kind === "systemd")
			console.error(`If there's no user session bus (servers, containers), run ${APP_NAME} serve directly.`);
		return 1;
	}
	if (await waitForHealth(url, deps.fetch ?? fetch, deps.waitMs ?? 10_000)) {
		console.log(`${chalk.green(`${APP_NAME} is awake`)} at ${url}. It starts when you log in.`);
	} else {
		console.log(
			chalk.yellow(`${APP_NAME} was installed (${plan.file}) but isn't answering yet. Check ${plan.logFile}`),
		);
	}
	console.log(`Logs: ${plan.logFile}\nStop it with ${APP_NAME} sleep.`);
	if (plan.kind === "systemd")
		console.log(chalk.dim(`To keep it running after you log out: loginctl enable-linger $USER`));
	return 0;
}

export function runSleep(args: string[], deps: WakeDeps = {}): number {
	if (args.includes("--help") || args.includes("-h")) {
		console.log(WAKE_HELP);
		return 0;
	}
	const plan = deps.plan ?? buildServicePlan();
	if (!plan) return unsupported();
	console.log(removeService(plan, deps.run ?? runCommand) ? `${APP_NAME} is asleep.` : `${APP_NAME} wasn't awake.`);
	return 0;
}
