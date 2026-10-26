import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMemoryCommand } from "../src/cli/memory-command.ts";
import {
	ensureMemoryVault,
	listMemoryFolders,
	resolveMemoryNote,
	searchMemory,
	writeMemoryNote,
} from "../src/core/memory/vault.ts";
import { buildMemoryPromptSection } from "../src/extensions/memory/index.ts";

let vault: string;

beforeEach(() => {
	vault = mkdtempSync(join(tmpdir(), "brian-memory-"));
});

afterEach(() => {
	rmSync(vault, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function seed(): void {
	writeMemoryNote(vault, {
		folder: "People",
		name: "Alex Kim",
		content: "Occupation: student\nEmail: alex@example.test",
		tags: ["friend"],
	});
	writeFileSync(
		join(vault, "People", "Alex Kim.md"),
		"---\ntags: [friend]\naliases: [AK]\n---\nOccupation: student\nEmail: alex@example.test\n",
	);
	writeMemoryNote(vault, {
		folder: "School",
		name: "Calculus finals",
		content: "Study group on Thursdays.",
		tags: ["#Exams"],
		people: ["Alex Kim"],
	});
	writeMemoryNote(vault, { folder: "Work/Acme", name: "Standup", content: "Daily at 9. [[Jordan Lee]] runs it." });
}

describe("memory vault", () => {
	it("creates People and Agent folders with a README", () => {
		ensureMemoryVault(vault);
		expect(existsSync(join(vault, "People"))).toBe(true);
		expect(existsSync(join(vault, "Agent", "Personality.md"))).toBe(true);
		expect(readFileSync(join(vault, "README.md"), "utf8")).toContain("brian memory search");
	});

	it("writes frontmatter tags and people and appends without duplicating them", () => {
		seed();
		const note = writeMemoryNote(vault, {
			folder: "School",
			name: "Calculus finals",
			content: "Exam is May 12.",
			tags: ["exams", "math"],
			people: ["alex kim"],
			mode: "append",
		});
		expect(note.tags).toEqual(["exams", "math"]);
		expect(note.people).toEqual(["Alex Kim"]);
		expect(note.body).toBe("Study group on Thursdays.\n\nExam is May 12.");
		expect(() => writeMemoryNote(vault, { folder: "School", name: "Calculus finals", content: "x" })).toThrow(
			/already exists/,
		);
	});

	it("rejects folder and name traversal", () => {
		expect(() => writeMemoryNote(vault, { folder: "../x", name: "a", content: "" })).toThrow(/Invalid memory folder/);
		expect(() => writeMemoryNote(vault, { folder: "Work", name: "a/b", content: "" })).toThrow(/Invalid memory name/);
	});

	it("searches by text, folder, tag, and person", () => {
		seed();
		const paths = (query: Parameters<typeof searchMemory>[1]) =>
			searchMemory(vault, query).map((r) => r.relativePath);
		expect(paths({ text: "thursdays" })).toEqual(["School/Calculus finals.md"]);
		expect(paths({ tags: ["exams"] })).toEqual(["School/Calculus finals.md"]);
		expect(paths({ people: ["Alex Kim"] })).toEqual(["People/Alex Kim.md", "School/Calculus finals.md"]);
		expect(paths({ people: ["ak"] })).toEqual(["People/Alex Kim.md"]);
		expect(paths({ people: ["Jordan Lee"] })).toEqual(["Work/Acme/Standup.md"]);
		expect(paths({ folder: "work" })).toEqual(["Work/Acme/Standup.md"]);
		expect(paths({ text: "study missingword" })).toEqual([]);
		expect(paths({ text: "alex" })[0]).toBe("People/Alex Kim.md");
	});

	it("resolves notes by path or unique name and counts folders", () => {
		seed();
		expect(resolveMemoryNote(vault, "Standup")).toBe(join(vault, "Work", "Acme", "Standup.md"));
		expect(resolveMemoryNote(vault, "People/Alex Kim")).toBe(join(vault, "People", "Alex Kim.md"));
		expect(resolveMemoryNote(vault, "../etc/passwd")).toBeUndefined();
		expect(listMemoryFolders(vault)).toEqual([
			{ folder: "Agent", notes: 1 },
			{ folder: "People", notes: 1 },
			{ folder: "School", notes: 1 },
			{ folder: "Work", notes: 0 },
			{ folder: "Work/Acme", notes: 1 },
		]);
	});

	it("puts Agent notes in the prompt section", () => {
		ensureMemoryVault(vault);
		mkdirSync(join(vault, "Agent"), { recursive: true });
		writeFileSync(join(vault, "Agent", "Voice.md"), "Write in lowercase.\n");
		const section = buildMemoryPromptSection(vault);
		expect(section).toContain(`Your memory vault is ${vault}`);
		expect(section).toContain("## Agent/Voice.md\nWrite in lowercase.");
	});
});

describe("brian memory command", () => {
	it("prints matching paths and exits 1 when nothing matches", () => {
		seed();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(runMemoryCommand(["search", "--person", "Alex Kim", "--folder", "School"], vault)).toBe(0);
		expect(log.mock.calls).toEqual([[join(vault, "School", "Calculus finals.md")]]);
		log.mockClear();
		expect(runMemoryCommand(["search", "nothing-here"], vault)).toBe(1);
		expect(log).not.toHaveBeenCalled();
	});

	it("adds a note from flags and prints its path", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(runMemoryCommand(["add", "Life/Gym", "-t", "health,routine", "-c", "Mon Wed Fri"], vault)).toBe(0);
		const file = join(vault, "Life", "Gym.md");
		expect(log.mock.calls).toEqual([[file]]);
		expect(readFileSync(file, "utf8")).toBe("---\ntags: [health, routine]\n---\nMon Wed Fri\n");
	});

	it("rejects unknown options", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(runMemoryCommand(["search", "--bogus"], vault)).toBe(1);
		expect(error.mock.calls[0]?.[0]).toContain("Unknown option: --bogus");
	});
});
