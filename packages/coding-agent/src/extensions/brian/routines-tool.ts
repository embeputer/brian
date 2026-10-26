import { StringEnum } from "@brian-agent/ai";
import { Type } from "typebox";
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { describeSchedule, type Routine, RoutineStore } from "./routines.ts";

function formatRoutine(r: Routine): string {
	return `${r.id} [${r.type}] ${describeSchedule(r)}: ${r.payload}${r.lastError ? ` (last error: ${r.lastError})` : ""}`;
}

export function installRoutines(brian: ExtensionAPI, store: RoutineStore = new RoutineStore()): void {
	brian.registerTool({
		name: "routines",
		label: "Routines",
		description:
			"Schedule reminders and recurring tasks for your user. reminder notifies with the text; task runs the text as a Brian prompt and notifies with the result. Routines run while `brian routines daemon` is running (or on `brian routines run`).",
		promptSnippet: "Create, list, pause, resume, or remove reminders and recurring tasks",
		promptGuidelines: [
			"Use routines when the user asks for a reminder, a recurring check, or something to happen later.",
			"Write task text as a full prompt Brian can run alone later, with every detail it needs.",
		],
		parameters: Type.Object({
			action: StringEnum(["create", "list", "remove", "pause", "resume", "history"] as const),
			type: Type.Optional(StringEnum(["reminder", "task"] as const)),
			text: Type.Optional(Type.String({ description: "Reminder text, or the prompt for a task" })),
			when: Type.Optional(Type.String({ description: "When to run first: 30m, 2h, tomorrow 9am, friday 17:00" })),
			recurrence: Type.Optional(
				Type.String({
					description: "once (default), daily, weekly, every 30m, every 2h, or a 5-field cron expression",
				}),
			),
			timezone: Type.Optional(Type.String({ description: "IANA timezone; defaults to the system timezone" })),
			id: Type.Optional(Type.String({ description: "Routine id for remove/pause/resume/history" })),
		}),
		async execute(_toolCallId, args) {
			const text = (value: string, details: Record<string, unknown> = {}) => ({
				content: [{ type: "text" as const, text: value }],
				details,
			});
			switch (args.action) {
				case "list": {
					const routines = store.list();
					return text(routines.length ? routines.map(formatRoutine).join("\n") : "No routines.", { routines });
				}
				case "history": {
					const runs = store.history(args.id, 10);
					return text(
						runs.length
							? runs
									.map(
										(r) =>
											`${new Date(r.startedAt).toISOString()} ${r.routineId} ${r.status}: ${r.output.slice(0, 300)}`,
									)
									.join("\n")
							: "No runs yet.",
						{ runs },
					);
				}
				case "create": {
					if (!args.text || !args.when) throw new Error("text and when are required to create a routine");
					const routine = store.add({
						type: args.type,
						payload: args.text,
						when: args.when,
						recurrence: args.recurrence,
						timezone: args.timezone,
					});
					return text(`Created ${formatRoutine(routine)}`, { routine });
				}
				default: {
					if (!args.id) throw new Error(`id is required for ${args.action}`);
					if (args.action === "remove") {
						if (!store.remove(args.id)) throw new Error(`No routine ${args.id}`);
						return text(`Removed ${args.id}`);
					}
					const routine = store.setEnabled(args.id, args.action === "resume");
					if (!routine) throw new Error(`No routine ${args.id}`);
					return text(formatRoutine(routine), { routine });
				}
			}
		},
	});
}
