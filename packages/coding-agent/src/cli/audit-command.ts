import { join } from "node:path";
import chalk from "chalk";
import { APP_NAME, getAgentDir, getMemoryDir } from "../config.ts";
import { AUDIT_PROMPT, buildAuditReport, formatAuditReport, type UsageStore } from "../core/audit.ts";
import { getUsageStore } from "../extensions/audit/index.ts";
import { createProcessExecutor, type RoutineExecutor } from "../extensions/brian/routine-runner.ts";
import { describeSchedule, RoutineStore } from "../extensions/brian/routines.ts";

const HELP = `Usage: ${APP_NAME} audit [options]

Review skills and memory: drop stale skills, add missing ones, tidy the vault.

  (no options)              Run the audit now (Brian acts on the report)
  --report [--json]         Only print the report
  --schedule [--when <t>]   Run it weekly as a routine (default: sunday 10am)
  --unschedule              Remove the weekly audit routine`;

export interface AuditDeps {
	usage?: UsageStore;
	routines?: RoutineStore;
	executor?: RoutineExecutor;
	skillsDir?: string;
	memoryDir?: string;
}

export async function runAuditCommand(args: string[], deps: AuditDeps = {}): Promise<number> {
	const usage = deps.usage ?? getUsageStore();
	const routines = deps.routines ?? new RoutineStore();
	const has = (flag: string) => args.includes(flag);
	if (has("--help") || has("-h")) {
		console.log(HELP);
		return 0;
	}
	const audits = () => routines.list().filter((r) => r.type === "task" && r.payload === AUDIT_PROMPT);
	try {
		if (has("--schedule")) {
			const index = args.indexOf("--when");
			const existing = audits();
			if (existing.length) {
				console.log(`Already scheduled: ${existing[0].id} ${describeSchedule(existing[0])}`);
				return 0;
			}
			const routine = routines.add({
				type: "task",
				payload: AUDIT_PROMPT,
				when: index >= 0 ? (args[index + 1] ?? "") : "sunday 10am",
				recurrence: "weekly",
			});
			console.log(`Weekly audit ${routine.id}: ${describeSchedule(routine)}`);
			console.log(chalk.dim(`Runs while \`${APP_NAME} routines daemon\` is running.`));
			return 0;
		}
		if (has("--unschedule")) {
			const existing = audits();
			for (const routine of existing) routines.remove(routine.id);
			console.log(existing.length ? `Removed ${existing.length} audit routine(s)` : "No audit routine scheduled");
			return 0;
		}
		const report = buildAuditReport({
			skillsDir: deps.skillsDir ?? join(getAgentDir(), "skills"),
			memoryDir: deps.memoryDir ?? getMemoryDir(),
			usage: usage.read(),
		});
		if (has("--report")) {
			console.log(has("--json") ? JSON.stringify(report, null, 2) : formatAuditReport(report));
			return 0;
		}
		const executor = deps.executor ?? createProcessExecutor();
		const output = await executor.runTask(`${AUDIT_PROMPT}\n\nCurrent report:\n${formatAuditReport(report)}`);
		usage.markAudited();
		console.log(output);
		return 0;
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		return 1;
	}
}
