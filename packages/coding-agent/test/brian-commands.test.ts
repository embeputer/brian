import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSkill, createSkill, isSelfUninstall, onboard, runBrianCommand } from "../src/cli/brian-commands.ts";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "brian-cmd-"));
	vi.stubEnv("BRIAN_AGENT_DIR", join(root, "agent"));
	vi.stubEnv("BRIAN_MEMORY_DIR", join(root, "memory"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("brian onboard", () => {
	it("writes the user's People note and Agent notes", () => {
		const memory = join(root, "memory");
		const written = onboard(
			{
				name: "Sam Rivera",
				nickname: "Sammy",
				email: "sam@example.test",
				occupation: "nurse",
				voice: "Short and warm.",
			},
			memory,
		);
		expect(written).toEqual([
			join(memory, "People", "Sam Rivera.md"),
			join(memory, "Agent", "User.md"),
			join(memory, "Agent", "Personality.md"),
		]);
		expect(readFileSync(join(memory, "People", "Sam Rivera.md"), "utf8")).toBe(
			"---\naliases: [Sammy]\ntags: [me]\n---\nOccupation: nurse\nEmail: sam@example.test\n",
		);
		expect(readFileSync(join(memory, "Agent", "Personality.md"), "utf8")).toContain("Short and warm.");
		expect(existsSync(join(root, "agent"))).toBe(true);
	});
});

describe("brian skill", () => {
	it("adds a markdown file as <name>/SKILL.md and refuses duplicates", () => {
		const skills = join(root, "skills");
		const file = join(root, "groceries.md");
		writeFileSync(file, "---\nname: groceries\ndescription: Weekly grocery list\n---\nSteps\n");
		expect(addSkill(file, skills)).toBe(join(skills, "groceries"));
		expect(readFileSync(join(skills, "groceries", "SKILL.md"), "utf8")).toContain("Weekly grocery list");
		expect(() => addSkill(file, skills)).toThrow(/already exists/);
		expect(addSkill(file, skills, true)).toBe(join(skills, "groceries"));
	});

	it("copies a skill directory and scaffolds new skills", () => {
		const skills = join(root, "skills");
		const dir = join(root, "src", "study-plan");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), "---\ndescription: Plan study sessions\n---\n");
		writeFileSync(join(dir, "notes.txt"), "x");
		expect(addSkill(dir, skills)).toBe(join(skills, "study-plan"));
		expect(existsSync(join(skills, "study-plan", "notes.txt"))).toBe(true);
		expect(createSkill("inbox-zero", "Triage email", skills)).toBe(join(skills, "inbox-zero", "SKILL.md"));
		expect(() => createSkill("Bad Name", "x", skills)).toThrow(/invalid skill name/);
	});

	it("lists and removes user skills through the command", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await runBrianCommand(["skill", "new", "inbox-zero", "-d", "Triage email"])).toBe(0);
		log.mockClear();
		expect(await runBrianCommand(["skill", "list"])).toBe(0);
		expect(log.mock.calls.some(([line]) => String(line).startsWith("inbox-zero"))).toBe(true);
		expect(await runBrianCommand(["skill", "remove", "inbox-zero"])).toBe(0);
		expect(existsSync(join(root, "agent", "skills", "inbox-zero"))).toBe(false);
	});
});

describe("brian uninstall", () => {
	it("keeps the package alias when a source is given", async () => {
		expect(isSelfUninstall(["uninstall"])).toBe(true);
		expect(isSelfUninstall(["uninstall", "--yes", "--keep-memory"])).toBe(true);
		expect(isSelfUninstall(["uninstall", "npm:some-ext"])).toBe(false);
		expect(isSelfUninstall(["uninstall", "-l"])).toBe(false);
		expect(await runBrianCommand(["uninstall", "npm:some-ext"])).toBeUndefined();
	});

	it("requires --yes", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await runBrianCommand(["uninstall"])).toBe(1);
	});
});

describe("brian model", () => {
	it("saves provider/model to settings", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		expect(await runBrianCommand(["model", "anthropic/claude-sonnet-4-5"])).toBe(0);
		const settings = JSON.parse(readFileSync(join(root, "agent", "settings.json"), "utf8"));
		expect(settings).toMatchObject({ defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" });
		log.mockClear();
		expect(await runBrianCommand(["model"])).toBe(0);
		expect(log.mock.calls).toEqual([["anthropic/claude-sonnet-4-5"]]);
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(await runBrianCommand(["model", "nope"])).toBe(1);
	});
});
