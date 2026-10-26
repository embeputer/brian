import { spawn } from "node:child_process";
import { join } from "node:path";
import { APP_TITLE, getAgentDir } from "../../config.ts";
import type { Routine, RoutineStore } from "./routines.ts";

export interface RunTaskOptions {
	/** Session file to write the run to, or to continue if it exists. */
	sessionFile?: string;
}

export interface RoutineExecutor {
	/** Run a Brian prompt and return its final text. */
	runTask(prompt: string, options?: RunTaskOptions): Promise<string>;
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
		async runTask(prompt, options) {
			const entry = process.argv[1];
			const session = options?.sessionFile ? ["--session", options.sessionFile] : [];
			const args = [...process.execArgv, ...(entry ? [entry] : []), ...session, "-p", prompt];
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

/** Sent to a task run that was cut off, in the session it was saved to. */
export const RESUME_PROMPT =
	"Brian restarted while you were working on this task. Continue from where you stopped and finish it. Tool calls above without a result may or may not have run: before redoing anything with side effects, such as sending a message or changing a file, check whether it already happened.";

/** A run cut off this many times is recorded as failed instead of resumed again. */
export const MAX_RESUMES = 2;

export function getRoutineRunsDir(): string {
	return join(getAgentDir(), "routine-runs");
}

async function runTask(
	store: RoutineStore,
	routine: Routine,
	executor: RoutineExecutor,
	runsDir: string,
): Promise<{ startedAt: number; output: string }> {
	const startedAt = routine.run?.startedAt ?? Date.now();
	const run = store.startRun(routine.id, {
		startedAt,
		sessionFile: join(runsDir, `${routine.id}-${startedAt}.jsonl`),
	});
	if (run.resumes > MAX_RESUMES) {
		throw Object.assign(new Error(`cut off by a restart ${run.resumes} times; not resuming again`), { startedAt });
	}
	const prompt = run.resumes > 0 ? RESUME_PROMPT : routine.payload;
	try {
		return { startedAt, output: await executor.runTask(prompt, { sessionFile: run.sessionFile }) };
	} catch (error) {
		throw Object.assign(error instanceof Error ? error : new Error(String(error)), { startedAt });
	}
}

export async function runRoutine(
	store: RoutineStore,
	routine: Routine,
	executor: RoutineExecutor,
	runsDir: string = getRoutineRunsDir(),
): Promise<string> {
	let startedAt = Date.now();
	try {
		let output = routine.payload;
		if (routine.type === "task") ({ startedAt, output } = await runTask(store, routine, executor, runsDir));
		await executor.notify(`${APP_TITLE} ${routine.type}`, output || "(no output)");
		store.recordRun(routine.id, { startedAt, finishedAt: Date.now(), status: "succeeded", output });
		return output;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (error instanceof Error && "startedAt" in error && typeof error.startedAt === "number")
			startedAt = error.startedAt;
		store.recordRun(routine.id, { startedAt, finishedAt: Date.now(), status: "failed", output: message });
		throw error;
	}
}

/** Run every due routine once, in order. Returns how many ran and how many failed. */
export async function runDueRoutines(
	store: RoutineStore,
	executor: RoutineExecutor,
	now: number = Date.now(),
	runsDir?: string,
): Promise<{ ran: number; failed: number }> {
	let ran = 0;
	let failed = 0;
	for (const routine of store.due(now)) {
		ran++;
		try {
			await runRoutine(store, routine, executor, runsDir);
		} catch {
			failed++;
		}
	}
	return { ran, failed };
}
