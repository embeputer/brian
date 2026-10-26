import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAuditCommand } from "../src/cli/audit-command.ts";
import { AUDIT_PROMPT, buildAuditReport, classifyUse, UsageStore } from "../src/core/audit.ts";
import { ensureMemoryVault, writeMemoryNote } from "../src/core/memory/vault.ts";
import { RoutineStore } from "../src/extensions/brian/routines.ts";

const DAY = 86_400_000;
let dir: string;
let skillsDir: string;
let memoryDir: string;
let usage: UsageStore;

function skill(name: string, ageDays: number): void {
	mkdirSync(join(skillsDir, name), { recursive: true });
	const file = join(skillsDir, name, "SKILL.md");
	writeFileSync(file, `---\nname: ${name}\ndescription: test\n---\nbody\n`);
	const t = (Date.now() - ageDays * DAY) / 1000;
	utimesSync(file, t, t);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "brian-audit-"));
	skillsDir = join(dir, "skills");
	memoryDir = join(dir, "memory");
	usage = new UsageStore(join(dir, "usage.json"));
	ensureMemoryVault(memoryDir);
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("audit", () => {
	it("classifies skill and memory reads", () => {
		expect(classifyUse(join(skillsDir, "taxes", "SKILL.md"), "/", skillsDir, memoryDir)).toEqual({
			kind: "skills",
			key: "taxes",
		});
		expect(classifyUse("School/Calc.md", memoryDir, skillsDir, memoryDir)).toEqual({
			kind: "memory",
			key: "School/Calc.md",
		});
		expect(classifyUse("/etc/hosts", "/", skillsDir, memoryDir)).toBeUndefined();
	});

	it("flags old unused skills but keeps new and used ones", () => {
		skill("old-unused", 60);
		skill("old-used", 60);
		skill("brand-new", 1);
		usage.record("skills", "old-used");
		const report = buildAuditReport({ skillsDir, memoryDir, usage: usage.read() });
		expect(report.skills.unused.map((s) => s.name)).toEqual(["old-unused"]);
		expect(report.skills.used.map((s) => s.name).sort()).toEqual(["brand-new", "old-used"]);
		expect(usage.read().skills["old-used"].uses).toBe(1);
	});

	it("finds untagged notes, missing people, and duplicates", () => {
		writeMemoryNote(memoryDir, { folder: "People", name: "Alex Kim", content: "friend" });
		writeMemoryNote(memoryDir, {
			folder: "School",
			name: "Finals",
			content: "study",
			people: ["Alex Kim", "Sam Lee"],
		});
		writeMemoryNote(memoryDir, { folder: "Work", name: "Finals", content: "q4", tags: ["work"] });
		writeMemoryNote(memoryDir, { folder: "Life", name: "Loose", content: "no tags" });
		mkdirSync(join(memoryDir, "Empty"));
		const report = buildAuditReport({ skillsDir, memoryDir, usage: usage.read() });
		expect(report.memory.untagged).toContain("Life/Loose.md");
		expect(report.memory.missingPeople).toEqual(["Sam Lee"]);
		expect(report.memory.duplicateNames).toEqual([expect.arrayContaining(["School/Finals.md", "Work/Finals.md"])]);
		expect(report.memory.emptyFolders).toEqual(["Empty"]);
	});

	it("schedules once, runs the prompt, and unschedules", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const routines = new RoutineStore(join(dir, "routines.json"));
		const prompts: string[] = [];
		const executor = {
			async runTask(prompt: string) {
				prompts.push(prompt);
				return "audited";
			},
			async notify() {},
		};
		const deps = { usage, routines, executor, skillsDir, memoryDir };
		expect(await runAuditCommand(["--schedule"], deps)).toBe(0);
		expect(await runAuditCommand(["--schedule"], deps)).toBe(0);
		expect(routines.list()).toHaveLength(1);
		expect(routines.list()[0]).toMatchObject({ type: "task", payload: AUDIT_PROMPT, recurrence: "weekly" });
		expect(await runAuditCommand([], deps)).toBe(0);
		expect(prompts[0]).toContain("Current report:");
		expect(usage.read().lastAudit).not.toBeNull();
		expect(await runAuditCommand(["--unschedule"], deps)).toBe(0);
		expect(routines.list()).toEqual([]);
	});
});
