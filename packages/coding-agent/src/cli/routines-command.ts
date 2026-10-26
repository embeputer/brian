import chalk from "chalk";
import { APP_NAME } from "../config.ts";
import {
	createProcessExecutor,
	type RoutineExecutor,
	runDueRoutines,
	runRoutine,
} from "../extensions/brian/routine-runner.ts";
import { describeSchedule, RoutineStore, type RoutineType } from "../extensions/brian/routines.ts";

const HELP = `Usage: ${APP_NAME} routines <command>

  list [--json]                                    List routines
  add <text> --when <time> [--every <recurrence>]  Add a reminder (or --task to run <text> as a prompt)
      [--task] [--tz <IANA zone>]                  time: 30m, 2h, tomorrow 9am; recurrence: daily, weekly, every 2h, cron
  remove <id>                                      Delete a routine
  pause <id> | resume <id>                         Stop or restart a routine
  history [id]                                     Show recent runs
  run [id]                                         Run due routines once (or one routine now)
  daemon [--interval <seconds>]                    Keep running due routines (default every 30s)`;

export async function runRoutinesCommand(
	args: string[],
	store: RoutineStore = new RoutineStore(),
	executor: RoutineExecutor = createProcessExecutor(),
): Promise<number> {
	const [sub, ...rest] = args;
	const positional: string[] = [];
	const values = new Map<string, string>();
	const switches = new Set<string>();
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (["--when", "--every", "--tz", "--interval"].includes(arg)) {
			const value = rest[++i];
			if (value === undefined) {
				console.error(chalk.red(`Error: ${arg} requires a value`));
				return 1;
			}
			values.set(arg, value);
		} else if (arg.startsWith("-")) switches.add(arg);
		else positional.push(arg);
	}
	if (!sub || sub === "help" || switches.has("--help") || switches.has("-h")) {
		console.log(HELP);
		return 0;
	}
	try {
		switch (sub) {
			case "list":
			case "ls": {
				const routines = store.list();
				if (switches.has("--json")) console.log(JSON.stringify(routines, null, 2));
				else if (routines.length === 0) console.log("No routines.");
				else
					for (const r of routines)
						console.log(`${r.id}  ${r.type.padEnd(8)} ${describeSchedule(r)}  ${r.payload}`);
				return 0;
			}
			case "add": {
				const when = values.get("--when");
				if (!positional.length || !when) throw new Error("add needs <text> and --when");
				const type: RoutineType = switches.has("--task") ? "task" : "reminder";
				const routine = store.add({
					type,
					payload: positional.join(" "),
					when,
					recurrence: values.get("--every"),
					timezone: values.get("--tz"),
				});
				console.log(`${routine.id}  ${describeSchedule(routine)}`);
				return 0;
			}
			case "remove":
			case "rm":
				if (!positional[0] || !store.remove(positional[0])) throw new Error(`no routine ${positional[0] ?? ""}`);
				console.log(`Removed ${positional[0]}`);
				return 0;
			case "pause":
			case "resume": {
				const routine = positional[0] ? store.setEnabled(positional[0], sub === "resume") : undefined;
				if (!routine) throw new Error(`no routine ${positional[0] ?? ""}`);
				console.log(`${routine.id}  ${describeSchedule(routine)}`);
				return 0;
			}
			case "history":
				for (const run of store.history(positional[0])) {
					console.log(
						`${new Date(run.startedAt).toLocaleString()}  ${run.routineId}  ${run.status}  ${run.output.split("\n")[0]}`,
					);
				}
				return 0;
			case "run": {
				if (positional[0]) {
					const routine = store.get(positional[0]);
					if (!routine) throw new Error(`no routine ${positional[0]}`);
					await runRoutine(store, routine, executor);
					return 0;
				}
				const { failed } = await runDueRoutines(store, executor);
				return failed ? 1 : 0;
			}
			case "daemon": {
				const seconds = Number(values.get("--interval") ?? 30);
				if (!Number.isFinite(seconds) || seconds < 1) throw new Error("--interval must be at least 1 second");
				console.log(`${APP_NAME} routines daemon: checking ${store.file} every ${seconds}s`);
				for (;;) {
					await runDueRoutines(store, executor);
					await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
				}
			}
			default:
				console.error(HELP);
				return 1;
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		return 1;
	}
}
