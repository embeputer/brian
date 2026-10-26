import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as chrono from "chrono-node";
import cronParser from "cron-parser";
import { getAgentDir } from "../../config.ts";
import {
	DEFAULT_TIME_ZONE,
	getTimeZoneOffsetMinutes,
	localDateParts,
	normalizeTimeZone,
	zonedWallTimeToUtc,
} from "./timezone.ts";

export type RoutineSchedule =
	| { kind: "once"; at: number }
	| { kind: "interval"; everyMs: number }
	| { kind: "cron"; cron: string };

/** `reminder` notifies with the text; `task` runs the text as a Brian prompt. */
export type RoutineType = "reminder" | "task";

export interface Routine {
	id: string;
	type: RoutineType;
	payload: string;
	when: string;
	recurrence: string;
	schedule: RoutineSchedule;
	timezone: string | null;
	enabled: boolean;
	nextRunAt: number | null;
	lastRunAt: number | null;
	lastStatus: "succeeded" | "failed" | null;
	lastError: string | null;
	createdAt: number;
}

export interface RoutineRun {
	routineId: string;
	startedAt: number;
	finishedAt: number;
	status: "succeeded" | "failed";
	output: string;
}

export interface RoutineInput {
	type?: RoutineType;
	payload: string;
	when: string;
	recurrence?: string;
	timezone?: string | null;
}

const ROUTINE_TYPES: readonly RoutineType[] = ["reminder", "task"];
const MAX_HISTORY = 500;
const MAX_OUTPUT = 4000;

export function getRoutinesPath(): string {
	return join(getAgentDir(), "routines.json");
}

function validTimezone(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
		return value;
	} catch {
		throw new Error(`Unknown timezone: "${value}"`);
	}
}

function parseShorthand(when: string): number | null {
	const match = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i.exec(when.trim());
	if (!match) return null;
	const n = Number(match[1]);
	const unit = match[2].toLowerCase();
	const ms = unit[0] === "m" ? 60000 : unit[0] === "h" ? 3600000 : 86400000;
	return Date.now() + n * ms;
}

function chronoReference(refDate: Date, timeZone: string | null): chrono.ParsingReference {
	if (!timeZone) return { instant: refDate };
	const normalized = normalizeTimeZone(timeZone);
	return { instant: refDate, timezone: getTimeZoneOffsetMinutes(normalized, refDate) };
}

export function parseTime(when: string, refDate: Date = new Date(), timeZone: string | null = null): number {
	const trimmed = String(when).trim();
	const shorthand = parseShorthand(trimmed);
	if (shorthand !== null) return shorthand;
	const zone = timeZone ? normalizeTimeZone(timeZone) : null;
	if (!zone) {
		const parsed = chrono.parseDate(trimmed, refDate, { forwardDate: true });
		if (parsed) return parsed.getTime();
	} else {
		const parsed = chrono.parse(trimmed, chronoReference(refDate, zone), { forwardDate: true });
		const start = parsed[0]?.start;
		if (start) {
			if (start.isCertain("timezoneOffset")) return start.date().getTime();
			return zonedWallTimeToUtc(
				{
					year: start.get("year") ?? refDate.getFullYear(),
					month: start.get("month") ?? refDate.getMonth() + 1,
					day: start.get("day") ?? refDate.getDate(),
					hour: start.get("hour") ?? 0,
					minute: start.get("minute") ?? 0,
					second: start.get("second") ?? 0,
				},
				zone,
			);
		}
	}
	const fallback = Date.parse(trimmed);
	if (!Number.isNaN(fallback)) return fallback;
	throw new Error(`Could not parse time: "${when}"`);
}

function parseEveryInterval(intervalStr: string): RoutineSchedule {
	const match = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i.exec(intervalStr.trim());
	if (!match) throw new Error(`Unknown interval: "${intervalStr}"`);
	const n = Number(match[1]);
	if (n <= 0) throw new Error("Interval must be greater than zero");
	const unit = match[2].toLowerCase();
	const everyMs = unit[0] === "m" ? n * 60000 : n * 3600000;
	if (!Number.isFinite(everyMs)) throw new Error("Interval is too large");
	return { kind: "interval", everyMs };
}

export function parseRecurrence(
	when: string,
	recurrence: string | null,
	timeZone: string | null = null,
): RoutineSchedule {
	const lower = String(recurrence || "once")
		.toLowerCase()
		.trim();
	const zone = timeZone ? normalizeTimeZone(timeZone) : null;
	if (lower === "once") return { kind: "once", at: parseTime(when, new Date(), zone) };
	if (lower === "daily" || lower === "weekly") {
		const at = parseTime(when, new Date(), zone);
		const parts = localDateParts(at, zone || DEFAULT_TIME_ZONE);
		return {
			kind: "cron",
			cron:
				lower === "daily"
					? `${parts.minute} ${parts.hour} * * *`
					: `${parts.minute} ${parts.hour} * * ${parts.weekday}`,
		};
	}
	const intervalMatch = /^every\s+(.+)$/i.exec(lower);
	if (intervalMatch) return parseEveryInterval(intervalMatch[1]);
	if (/^[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+$/.test(lower)) return { kind: "cron", cron: lower };
	throw new Error(`Unknown recurrence: "${recurrence}"`);
}

function localHour(at: number, timezone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		hourCycle: "h23",
	}).formatToParts(at);
	return Number(parts.find((p) => p.type === "hour")?.value) || 0;
}

interface ActiveHours {
	start: number;
	end: number;
	timezone: string;
}

function inActiveHours(activeHours: ActiveHours | null, at: number): boolean {
	if (!activeHours) return true;
	const hour = localHour(at, activeHours.timezone);
	if (activeHours.start === activeHours.end) return true;
	if (activeHours.start < activeHours.end) return hour >= activeHours.start && hour < activeHours.end;
	return hour >= activeHours.start || hour < activeHours.end;
}

function nextActiveTime(activeHours: ActiveHours | null, from: number): number {
	if (!activeHours || inActiveHours(activeHours, from)) return from;
	let candidate = from - (from % 60000) + 60000;
	const limit = candidate + 48 * 3600000;
	while (candidate <= limit) {
		if (inActiveHours(activeHours, candidate)) return candidate;
		candidate += 60000;
	}
	return candidate;
}

export function computeNextRun(
	schedule: RoutineSchedule,
	afterMs: number = Date.now(),
	timezone: string | null = null,
	activeHours: ActiveHours | null = null,
): number | null {
	let next: number | null = null;
	if (schedule.kind === "once") {
		next = schedule.at > afterMs ? schedule.at : null;
	} else if (schedule.kind === "interval") {
		next = afterMs + schedule.everyMs;
	} else {
		try {
			const parser = cronParser.CronExpressionParser || cronParser;
			const expr = parser.parse(schedule.cron, {
				currentDate: new Date(afterMs),
				...(timezone ? { tz: timezone } : {}),
			});
			next = expr.next().getTime();
		} catch {
			throw new Error(`Invalid cron expression "${schedule.cron}"`);
		}
	}
	return next === null ? null : nextActiveTime(activeHours, next);
}

interface RoutineFile {
	routines: Routine[];
	history: RoutineRun[];
}

/** Local routine store in ~/.brian/agent/routines.json. Reads the file on every call so CLI, daemon, and tools agree. */
export class RoutineStore {
	readonly file: string;

	constructor(file: string = getRoutinesPath()) {
		this.file = file;
	}

	private read(): RoutineFile {
		if (!existsSync(this.file)) return { routines: [], history: [] };
		const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<RoutineFile>;
		return {
			routines: Array.isArray(parsed.routines) ? parsed.routines : [],
			history: Array.isArray(parsed.history) ? parsed.history : [],
		};
	}

	private write(data: RoutineFile): void {
		mkdirSync(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(tmp, `${JSON.stringify({ ...data, history: data.history.slice(-MAX_HISTORY) }, null, 2)}\n`, {
			mode: 0o600,
		});
		renameSync(tmp, this.file);
	}

	private update<T>(fn: (data: RoutineFile) => T): T {
		const data = this.read();
		const result = fn(data);
		this.write(data);
		return result;
	}

	list(): Routine[] {
		return this.read().routines;
	}

	get(id: string): Routine | undefined {
		return this.list().find((r) => r.id === id);
	}

	history(routineId?: string, limit = 20): RoutineRun[] {
		return this.read()
			.history.filter((h) => !routineId || h.routineId === routineId)
			.slice(-Math.max(1, limit))
			.reverse();
	}

	add(input: RoutineInput, now: number = Date.now()): Routine {
		const type = input.type ?? "reminder";
		if (!ROUTINE_TYPES.includes(type)) throw new Error(`Invalid routine type "${type}", use reminder or task`);
		if (!input.payload.trim()) throw new Error("Routine text is required");
		const recurrence = input.recurrence?.trim() || "once";
		const zone = validTimezone(input.timezone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
		const schedule = parseRecurrence(input.when, recurrence, zone);
		const nextRunAt =
			schedule.kind === "interval" ? computeNextRun(schedule, now, zone) : computeNextRun(schedule, now - 1, zone);
		if (nextRunAt === null) throw new Error("Scheduled time is in the past");
		const routine: Routine = {
			id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
			type,
			payload: input.payload.trim(),
			when: input.when,
			recurrence,
			schedule,
			timezone: zone,
			enabled: true,
			nextRunAt,
			lastRunAt: null,
			lastStatus: null,
			lastError: null,
			createdAt: now,
		};
		return this.update((data) => {
			data.routines.push(routine);
			return routine;
		});
	}

	remove(id: string): boolean {
		return this.update((data) => {
			const before = data.routines.length;
			data.routines = data.routines.filter((r) => r.id !== id);
			return data.routines.length !== before;
		});
	}

	setEnabled(id: string, enabled: boolean, now: number = Date.now()): Routine | undefined {
		return this.update((data) => {
			const routine = data.routines.find((r) => r.id === id);
			if (!routine) return undefined;
			routine.enabled = enabled;
			if (enabled && routine.schedule.kind !== "once") {
				routine.nextRunAt = computeNextRun(routine.schedule, now, routine.timezone);
			}
			return routine;
		});
	}

	/** Routines whose next run is at or before `now`. */
	due(now: number = Date.now()): Routine[] {
		return this.list().filter((r) => r.enabled && r.nextRunAt !== null && r.nextRunAt <= now);
	}

	/** Record a run and schedule the next one. One-shot routines are disabled after they run. */
	recordRun(id: string, run: Omit<RoutineRun, "routineId">): void {
		this.update((data) => {
			const routine = data.routines.find((r) => r.id === id);
			data.history.push({ routineId: id, ...run, output: run.output.slice(0, MAX_OUTPUT) });
			if (!routine) return;
			routine.lastRunAt = run.startedAt;
			routine.lastStatus = run.status;
			routine.lastError = run.status === "failed" ? run.output.slice(0, 500) : null;
			routine.nextRunAt =
				routine.schedule.kind === "once"
					? null
					: computeNextRun(routine.schedule, run.finishedAt, routine.timezone);
			if (routine.nextRunAt === null) routine.enabled = false;
		});
	}
}

export function describeSchedule(routine: Routine): string {
	const next = routine.nextRunAt ? new Date(routine.nextRunAt).toLocaleString() : "-";
	const repeat = routine.recurrence === "once" ? "once" : routine.recurrence;
	return `${repeat}, next ${routine.enabled ? next : "paused"}`;
}
