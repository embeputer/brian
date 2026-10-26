/**
 * Usage tracking and the weekly skill/memory audit report.
 *
 * Usage lives in `<agent dir>/usage.json` so the audit can tell which skills and notes
 * Brian actually reads. The report is plain data; the audit itself is a Brian prompt that
 * acts on it (delete stale skills, add missing ones, reorganize memory).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { APP_NAME } from "../config.ts";
import { listMemoryFolders, listMemoryNotes } from "./memory/vault.ts";

const DAY = 86_400_000;

export interface UsageEntry {
	lastUsed: number;
	uses: number;
}

export interface UsageData {
	skills: Record<string, UsageEntry>;
	memory: Record<string, UsageEntry>;
	lastAudit: number | null;
}

export class UsageStore {
	readonly file: string;

	constructor(file: string) {
		this.file = file;
	}

	read(): UsageData {
		try {
			const data = JSON.parse(readFileSync(this.file, "utf8")) as Partial<UsageData>;
			return { skills: data.skills ?? {}, memory: data.memory ?? {}, lastAudit: data.lastAudit ?? null };
		} catch {
			return { skills: {}, memory: {}, lastAudit: null };
		}
	}

	private write(data: UsageData): void {
		mkdirSync(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(data, null, "\t")}\n`, { mode: 0o600 });
		renameSync(tmp, this.file);
	}

	record(kind: "skills" | "memory", key: string, now: number = Date.now()): void {
		const data = this.read();
		const entry = data[kind][key] ?? { lastUsed: 0, uses: 0 };
		data[kind][key] = { lastUsed: now, uses: entry.uses + 1 };
		this.write(data);
	}

	markAudited(now: number = Date.now()): void {
		const data = this.read();
		data.lastAudit = now;
		this.write(data);
	}
}

/** Map a file path Brian touched to a skill name or a vault-relative note path. */
export function classifyUse(
	file: string,
	cwd: string,
	skillsDir: string,
	memoryDir: string,
): { kind: "skills" | "memory"; key: string } | undefined {
	const abs = isAbsolute(file) ? file : join(cwd, file);
	if (basename(abs) === "SKILL.md") return { kind: "skills", key: basename(dirname(abs)) };
	const inSkills = relative(skillsDir, abs);
	if (!inSkills.startsWith("..") && !isAbsolute(inSkills)) {
		return { kind: "skills", key: inSkills.split(sep)[0].replace(/\.md$/, "") };
	}
	const inMemory = relative(memoryDir, abs);
	if (!inMemory.startsWith("..") && !isAbsolute(inMemory) && abs.endsWith(".md")) {
		return { kind: "memory", key: inMemory.split(sep).join("/") };
	}
	return undefined;
}

export interface AuditSkill {
	name: string;
	path: string;
	uses: number;
	lastUsed: number | null;
	ageDays: number;
}

export interface AuditReport {
	generatedAt: number;
	lastAudit: number | null;
	skills: { total: number; unused: AuditSkill[]; used: AuditSkill[] };
	memory: {
		total: number;
		folders: Array<{ folder: string; notes: number }>;
		untagged: string[];
		stale: string[];
		missingPeople: string[];
		duplicateNames: string[][];
		emptyFolders: string[];
	};
}

export interface AuditOptions {
	skillsDir: string;
	memoryDir: string;
	usage: UsageData;
	now?: number;
	/** Skills unused for this many days (and older than that) are flagged. */
	unusedSkillDays?: number;
	/** Notes not modified or read for this many days are flagged. */
	staleNoteDays?: number;
}

function listSkillDirs(skillsDir: string): Array<{ name: string; path: string; mtime: number }> {
	if (!existsSync(skillsDir)) return [];
	return readdirSync(skillsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, "SKILL.md")))
		.map((entry) => {
			const path = join(skillsDir, entry.name, "SKILL.md");
			return { name: entry.name, path, mtime: statSync(path).mtimeMs };
		});
}

export function buildAuditReport(options: AuditOptions): AuditReport {
	const now = options.now ?? Date.now();
	const unusedCutoff = now - (options.unusedSkillDays ?? 30) * DAY;
	const staleCutoff = now - (options.staleNoteDays ?? 180) * DAY;
	const { usage } = options;

	const skills = listSkillDirs(options.skillsDir).map((skill): AuditSkill => {
		const entry = usage.skills[skill.name];
		return {
			name: skill.name,
			path: skill.path,
			uses: entry?.uses ?? 0,
			lastUsed: entry?.lastUsed ?? null,
			ageDays: Math.floor((now - skill.mtime) / DAY),
		};
	});
	const isUnused = (s: AuditSkill) => (s.lastUsed ?? 0) < unusedCutoff && now - s.ageDays * DAY < unusedCutoff;

	const notes = existsSync(options.memoryDir) ? listMemoryNotes(options.memoryDir) : [];
	const peopleNotes = new Set<string>();
	for (const note of notes) {
		if (note.folder === "People" || note.folder.startsWith("People/")) {
			peopleNotes.add(note.name.toLowerCase());
			for (const alias of note.aliases) peopleNotes.add(alias.toLowerCase());
		}
	}
	const missingPeople = new Set<string>();
	const byName = new Map<string, string[]>();
	for (const note of notes) {
		for (const person of note.people) if (!peopleNotes.has(person.toLowerCase())) missingPeople.add(person);
		const key = note.name.toLowerCase();
		byName.set(key, [...(byName.get(key) ?? []), note.relativePath]);
	}
	const folders = existsSync(options.memoryDir) ? listMemoryFolders(options.memoryDir) : [];
	const isAgentOrPeople = (folder: string) => folder === "Agent" || folder === "People";

	return {
		generatedAt: now,
		lastAudit: usage.lastAudit,
		skills: { total: skills.length, unused: skills.filter(isUnused), used: skills.filter((s) => !isUnused(s)) },
		memory: {
			total: notes.length,
			folders,
			untagged: notes
				.filter((n) => n.tags.length === 0 && n.people.length === 0 && n.folder !== "Agent" && n.name !== "README")
				.map((n) => n.relativePath),
			stale: notes
				.filter((n) => n.updatedAt < staleCutoff && (usage.memory[n.relativePath]?.lastUsed ?? 0) < staleCutoff)
				.map((n) => n.relativePath),
			missingPeople: [...missingPeople].sort(),
			duplicateNames: [...byName.values()].filter((paths) => paths.length > 1),
			emptyFolders: folders.filter((f) => f.notes === 0 && !isAgentOrPeople(f.folder)).map((f) => f.folder),
		},
	};
}

function when(ms: number | null, now: number): string {
	return ms ? `${Math.floor((now - ms) / DAY)}d ago` : "never";
}

export function formatAuditReport(report: AuditReport): string {
	const now = report.generatedAt;
	const list = (items: string[]) => (items.length ? items.map((i) => `  - ${i}`).join("\n") : "  (none)");
	const m = report.memory;
	return [
		`Last audit: ${when(report.lastAudit, now)}`,
		"",
		`Skills: ${report.skills.total}`,
		"Unused (candidates to delete or rewrite):",
		list(report.skills.unused.map((s) => `${s.name}: ${s.uses} uses, last ${when(s.lastUsed, now)} (${s.path})`)),
		"In use:",
		list(report.skills.used.map((s) => `${s.name}: ${s.uses} uses, last ${when(s.lastUsed, now)}`)),
		"",
		`Memory notes: ${m.total} in ${m.folders.length} folders (${m.folders.map((f) => `${f.folder} ${f.notes}`).join(", ")})`,
		"No tags or people (hard to find):",
		list(m.untagged),
		"Stale (not changed or read in a long time):",
		list(m.stale),
		"People linked without a People/ note:",
		list(m.missingPeople),
		"Same name in several folders (merge?):",
		list(m.duplicateNames.map((paths) => paths.join(" | "))),
		"Empty folders:",
		list(m.emptyFolders),
	].join("\n");
}

export const AUDIT_PROMPT = `Run your weekly audit of skills and memory so you stay sharp and grounded in what matters to your user now.

1. Run \`${APP_NAME} audit --report\` and read it. Use \`${APP_NAME} memory search\`, \`${APP_NAME} memory show\`, and \`${APP_NAME} skill show\` to look closer.
2. Skills: delete a skill (\`${APP_NAME} skill remove <name>\`) only when it is unused AND you are confident it will not be needed. Keep rarely used skills that still matter. Fix skills that are wrong or outdated. Create a skill (\`${APP_NAME} skill new\`) for any workflow you repeated by hand that deserves one.
3. Memory: add tags/people to untagged notes, create missing People notes from what you know, merge duplicates, move notes into the right folders, delete facts that are no longer true, and record anything recent you learned but did not save. Never store secrets.
4. Finish with a short summary: what you removed, created, changed, and anything you need your user to confirm.`;
