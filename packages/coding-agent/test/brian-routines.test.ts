import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRoutinesCommand } from "../src/cli/routines-command.ts";
import { type RoutineExecutor, runDueRoutines } from "../src/extensions/brian/routine-runner.ts";
import { RoutineStore } from "../src/extensions/brian/routines.ts";

let dir: string;
let store: RoutineStore;

function executor(): RoutineExecutor & { tasks: string[]; notes: string[] } {
	const tasks: string[] = [];
	const notes: string[] = [];
	return {
		tasks,
		notes,
		async runTask(prompt) {
			tasks.push(prompt);
			if (prompt === "boom") throw new Error("task failed");
			return `done: ${prompt}`;
		},
		async notify(_title, body) {
			notes.push(body);
		},
	};
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "brian-routines-"));
	store = new RoutineStore(join(dir, "routines.json"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("RoutineStore", () => {
	it("runs a one-shot reminder once and disables it", async () => {
		const now = Date.now();
		const routine = store.add({ payload: "call mom", when: "30m" }, now);
		expect(routine.nextRunAt).toBeGreaterThan(now + 29 * 60_000);
		const exec = executor();
		expect(await runDueRoutines(store, exec, now)).toEqual({ ran: 0, failed: 0 });
		expect(await runDueRoutines(store, exec, now + 31 * 60_000)).toEqual({ ran: 1, failed: 0 });
		expect(exec.notes).toEqual(["call mom"]);
		expect(store.get(routine.id)).toMatchObject({ enabled: false, nextRunAt: null, lastStatus: "succeeded" });
		expect(await runDueRoutines(store, exec, now + 60 * 60_000)).toEqual({ ran: 0, failed: 0 });
	});

	it("reschedules recurring tasks and records failures", async () => {
		const now = Date.now();
		const ok = store.add({ type: "task", payload: "summarize inbox", when: "now", recurrence: "every 2h" }, now);
		const bad = store.add({ type: "task", payload: "boom", when: "now", recurrence: "every 1h" }, now);
		const exec = executor();
		const later = now + 2 * 3_600_000 + 1000;
		expect(await runDueRoutines(store, exec, later)).toEqual({ ran: 2, failed: 1 });
		expect(exec.notes).toEqual(["done: summarize inbox"]);
		expect(store.get(ok.id)?.enabled).toBe(true);
		expect(store.get(ok.id)?.nextRunAt).toBeGreaterThan(Date.now());
		expect(store.get(bad.id)).toMatchObject({ lastStatus: "failed", lastError: "task failed", enabled: true });
		expect(store.history().map((h) => h.status)).toEqual(["failed", "succeeded"]);
	});

	it("pauses, resumes, and validates input", () => {
		const routine = store.add({ payload: "stretch", when: "9am", recurrence: "daily", timezone: "Europe/Vilnius" });
		expect(routine.schedule).toEqual({ kind: "cron", cron: "0 9 * * *" });
		expect(store.setEnabled(routine.id, false)?.enabled).toBe(false);
		expect(store.due(Date.now() + 2 * 86_400_000)).toEqual([]);
		expect(store.setEnabled(routine.id, true)?.enabled).toBe(true);
		expect(() => store.add({ payload: "x", when: "9am", timezone: "Mars/Base" })).toThrow(/Unknown timezone/);
		expect(() => store.add({ payload: " ", when: "1h" })).toThrow(/text is required/);
		expect(store.remove(routine.id)).toBe(true);
		expect(store.list()).toEqual([]);
	});
});

describe("brian routines command", () => {
	it("adds, lists, and runs a routine", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const exec = executor();
		expect(
			await runRoutinesCommand(["add", "water", "the", "plants", "--when", "1h", "--every", "daily"], store, exec),
		).toBe(0);
		const [routine] = store.list();
		expect(routine).toMatchObject({ type: "reminder", payload: "water the plants", recurrence: "daily" });
		expect(await runRoutinesCommand(["run", routine.id], store, exec)).toBe(0);
		expect(exec.notes).toEqual(["water the plants"]);
		log.mockClear();
		expect(await runRoutinesCommand(["list"], store, exec)).toBe(0);
		expect(String(log.mock.calls[0]?.[0])).toContain("water the plants");
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await runRoutinesCommand(["add", "no time"], store, exec)).toBe(1);
	});
});
