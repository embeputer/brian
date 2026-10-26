import { spawn } from "node:child_process";
import { APP_TITLE } from "../../config.ts";
import type { Routine, RoutineStore } from "./routines.ts";

export interface RoutineExecutor {
	/** Run a Brian prompt and return its final text. */
	runTask(prompt: string): Promise<string>;
	/** Show a notification to the user. */
	notify(title: string, body: string): Promise<void>;
}

function run(command: string, args: string[], timeoutMs: number): Promise<{ code: number; output: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
		let output = "";
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on("error", (error) => resolve({ code: 1, output: error.message }));
		child.on("close", (code) => resolve({ code: code ?? 1, output: output.trim() }));
	});
}

/** Spawns this same CLI in print mode for tasks and uses the OS notifier for reminders. */
export function createProcessExecutor(): RoutineExecutor {
	return {
		async runTask(prompt) {
			const entry = process.argv[1];
			const args = [...process.execArgv, ...(entry ? [entry] : []), "-p", prompt];
			const result = await run(process.execPath, args, 30 * 60_000);
			if (result.code !== 0) throw new Error(result.output || `exit ${result.code}`);
			return result.output;
		},
		async notify(title, body) {
			console.log(`[${title}] ${body}`);
			const text = body.length > 240 ? `${body.slice(0, 237)}...` : body;
			if (process.platform === "darwin") {
				await run(
					"osascript",
					["-e", `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`],
					10_000,
				);
			} else if (process.platform === "linux") {
				await run("notify-send", [title, text], 5_000);
			}
		},
	};
}

export async function runRoutine(store: RoutineStore, routine: Routine, executor: RoutineExecutor): Promise<string> {
	const startedAt = Date.now();
	try {
		const output = routine.type === "task" ? await executor.runTask(routine.payload) : routine.payload;
		await executor.notify(`${APP_TITLE} ${routine.type}`, output || "(no output)");
		store.recordRun(routine.id, { startedAt, finishedAt: Date.now(), status: "succeeded", output });
		return output;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		store.recordRun(routine.id, { startedAt, finishedAt: Date.now(), status: "failed", output: message });
		throw error;
	}
}

/** Run every due routine once, in order. Returns how many ran and how many failed. */
export async function runDueRoutines(
	store: RoutineStore,
	executor: RoutineExecutor,
	now: number = Date.now(),
): Promise<{ ran: number; failed: number }> {
	let ran = 0;
	let failed = 0;
	for (const routine of store.due(now)) {
		ran++;
		try {
			await runRoutine(store, routine, executor);
		} catch {
			failed++;
		}
	}
	return { ran, failed };
}
