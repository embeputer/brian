/**
 * Markdown memory vault: a folder of plain `.md` notes that Brian (or any other agent) can read and search.
 *
 * Layout: `<vault>/<Folder>/<Note name>.md`. `People/` and `Agent/` always exist; any other folder
 * (Work, School, Relationships, ...) is created on demand. Each note has optional YAML frontmatter:
 *
 *   ---
 *   tags: [school, exams]
 *   people: [Alex Kim]
 *   ---
 *   body text
 */

import { type Dirent, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { Document, isSeq, visit } from "yaml";
import { parseFrontmatter } from "../../utils/frontmatter.ts";

export const DEFAULT_MEMORY_FOLDERS = ["People", "Agent"] as const;

const VAULT_README = `# Brian memory vault

Plain markdown notes, one memory per file. The file name is the memory's name.

- \`People/\`: one note per person (full name, nicknames, occupation, email, phone, description)
- \`Agent/\`: Brian's own notes (personality, preferences about how to act)
- any other folder (Work, School, Life, Relationships, ...) groups the rest

Frontmatter links a note to tags and people:

\`\`\`markdown
---
tags: [school, exams]
people: [Alex Kim]
---
Alex and I study for finals together on Thursdays.
\`\`\`

\`[[Name]]\` links in the body also count as people links.
Search from any agent or shell with \`brian memory search <text> --folder <f> --tag <t> --person <p>\`.
`;

const PERSONALITY_TEMPLATE = `---
tags: [personality]
---
How Brian should sound and act when it speaks for its user. Brian fills this in as it learns.
`;

export interface MemoryNote {
	name: string;
	/** Folder path relative to the vault, `/`-separated. Empty for notes at the vault root. */
	folder: string;
	path: string;
	relativePath: string;
	tags: string[];
	people: string[];
	/** Other names that refer to this note's subject (People notes: `aliases`/`nicknames`). */
	aliases: string[];
	frontmatter: Record<string, unknown>;
	body: string;
	updatedAt: number;
}

export interface MemorySearchQuery {
	text?: string;
	folder?: string;
	tags?: string[];
	people?: string[];
	limit?: number;
}

export interface MemorySearchResult {
	name: string;
	folder: string;
	path: string;
	relativePath: string;
	tags: string[];
	people: string[];
	score: number;
	snippet: string;
}

export type MemoryWriteMode = "create" | "replace" | "append";

export interface MemoryWriteInput {
	folder: string;
	name: string;
	content: string;
	tags?: string[];
	people?: string[];
	mode?: MemoryWriteMode;
}

export function ensureMemoryVault(vaultDir: string): void {
	mkdirSync(vaultDir, { recursive: true });
	for (const folder of DEFAULT_MEMORY_FOLDERS) mkdirSync(join(vaultDir, folder), { recursive: true });
	const readme = join(vaultDir, "README.md");
	if (!existsSync(readme)) writeFileSync(readme, VAULT_README);
	const personality = join(vaultDir, "Agent", "Personality.md");
	if (!existsSync(personality)) writeFileSync(personality, PERSONALITY_TEMPLATE);
}

function toList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).map((v) => String(v).trim());
	if (typeof value === "string")
		return value
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	return [];
}

function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#/, "").toLowerCase();
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

function wikiLinks(body: string): string[] {
	const links: string[] = [];
	for (const match of body.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) links.push(match[1].trim());
	return links;
}

function isVaultReadme(vaultDir: string, file: string): boolean {
	return dirname(file) === vaultDir && file.slice(vaultDir.length + 1).toLowerCase() === "readme.md";
}

function collectMarkdownFiles(dir: string, out: string[]): void {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) collectMarkdownFiles(full, out);
		else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(full);
	}
}

export function readMemoryNote(vaultDir: string, file: string): MemoryNote {
	const raw = readFileSync(file, "utf8");
	let frontmatter: Record<string, unknown> = {};
	let body: string;
	try {
		({ frontmatter, body } = parseFrontmatter(raw));
	} catch {
		body = raw;
	}
	const relativePath = toPosix(relative(vaultDir, file));
	const folder = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
	const name = relativePath.slice(relativePath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
	const people = [...toList(frontmatter.people), ...toList(frontmatter.person)];
	for (const link of wikiLinks(body)) if (!people.includes(link)) people.push(link);
	return {
		name,
		folder,
		path: file,
		relativePath,
		tags: [...new Set([...toList(frontmatter.tags), ...toList(frontmatter.tag)].map(normalizeTag))].filter(Boolean),
		people,
		aliases: [...toList(frontmatter.aliases), ...toList(frontmatter.nicknames), ...toList(frontmatter.nickname)],
		frontmatter,
		body,
		updatedAt: statSync(file).mtimeMs,
	};
}

export function listMemoryNotes(vaultDir: string, folder?: string): MemoryNote[] {
	const files: string[] = [];
	collectMarkdownFiles(vaultDir, files);
	const notes = files.filter((file) => !isVaultReadme(vaultDir, file)).map((file) => readMemoryNote(vaultDir, file));
	const filtered = folder ? notes.filter((note) => matchesFolder(note.folder, folder)) : notes;
	return filtered.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function listMemoryFolders(vaultDir: string): Array<{ folder: string; notes: number }> {
	const counts = new Map<string, number>();
	const walk = (dir: string): void => {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
			const full = join(dir, entry.name);
			counts.set(toPosix(relative(vaultDir, full)), 0);
			walk(full);
		}
	};
	walk(vaultDir);
	for (const note of listMemoryNotes(vaultDir)) {
		if (note.folder) counts.set(note.folder, (counts.get(note.folder) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([folder, notes]) => ({ folder, notes }))
		.sort((a, b) => a.folder.localeCompare(b.folder));
}

function matchesFolder(noteFolder: string, folder: string): boolean {
	const want = folder.replace(/^\/+|\/+$/g, "").toLowerCase();
	const have = noteFolder.toLowerCase();
	return have === want || have.startsWith(`${want}/`);
}

function matchesPerson(note: MemoryNote, person: string): boolean {
	const want = person.trim().toLowerCase();
	const names = [...note.people, ...(note.folder.toLowerCase() === "people" ? [note.name, ...note.aliases] : [])];
	return names.some((name) => name.toLowerCase() === want);
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1 && count < 20) {
		count++;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

function snippetFor(note: MemoryNote, terms: string[]): string {
	const lines = note.body.split("\n").filter((line) => line.trim());
	const hit =
		terms.length > 0 ? lines.find((line) => terms.some((term) => line.toLowerCase().includes(term))) : undefined;
	const line = (hit ?? lines[0] ?? "").trim();
	return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

/** Find notes matching every given filter. Text terms are ANDed; results are ranked by where terms appear. */
export function searchMemory(vaultDir: string, query: MemorySearchQuery): MemorySearchResult[] {
	const terms = (query.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	const tags = (query.tags ?? []).map(normalizeTag).filter(Boolean);
	const people = (query.people ?? []).map((p) => p.trim()).filter(Boolean);
	const results: MemorySearchResult[] = [];
	for (const note of listMemoryNotes(vaultDir, query.folder)) {
		if (!tags.every((tag) => note.tags.includes(tag))) continue;
		if (!people.every((person) => matchesPerson(note, person))) continue;
		const name = note.name.toLowerCase();
		const meta = [...note.tags, ...note.people, ...note.aliases].join(" ").toLowerCase();
		const body = note.body.toLowerCase();
		let score = terms.length === 0 ? 1 : 0;
		let matchedAll = true;
		for (const term of terms) {
			const termScore =
				(name.includes(term) ? 10 : 0) + (meta.includes(term) ? 5 : 0) + countOccurrences(body, term);
			if (termScore === 0) {
				matchedAll = false;
				break;
			}
			score += termScore;
		}
		if (!matchedAll) continue;
		results.push({
			name: note.name,
			folder: note.folder,
			path: note.path,
			relativePath: note.relativePath,
			tags: note.tags,
			people: note.people,
			score,
			snippet: snippetFor(note, terms),
		});
	}
	results.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
	return query.limit && query.limit > 0 ? results.slice(0, query.limit) : results;
}

function safeSegment(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/:*?"<>|\0]/.test(trimmed) || trimmed.startsWith(".")) {
		throw new Error(`Invalid memory ${label}: ${JSON.stringify(value)}`);
	}
	return trimmed;
}

/** Resolve `Folder/Sub` to a safe vault-relative folder path. */
export function normalizeMemoryFolder(folder: string): string {
	return folder
		.split("/")
		.filter((part) => part.trim())
		.map((part) => safeSegment(part, "folder"))
		.join("/");
}

/** Resolve a note reference (`Folder/Name`, `Folder/Name.md`, absolute path inside the vault, or a unique name). */
export function resolveMemoryNote(vaultDir: string, ref: string): string | undefined {
	const cleaned = ref.trim();
	const candidates = [cleaned, `${cleaned}.md`].map((c) => (c.startsWith(vaultDir) ? c : join(vaultDir, c)));
	for (const candidate of candidates) {
		if (
			!toPosix(relative(vaultDir, candidate)).startsWith("..") &&
			existsSync(candidate) &&
			statSync(candidate).isFile()
		) {
			return candidate;
		}
	}
	const want = cleaned.replace(/\.md$/i, "").toLowerCase();
	const matches = listMemoryNotes(vaultDir).filter((note) => note.name.toLowerCase() === want);
	return matches.length === 1 ? matches[0].path : undefined;
}

function mergeList(existing: string[], added: string[] | undefined): string[] {
	const out = [...existing];
	for (const item of added ?? []) if (!out.some((e) => e.toLowerCase() === item.toLowerCase())) out.push(item);
	return out;
}

function renderNote(frontmatter: Record<string, unknown>, body: string): string {
	const meta = Object.fromEntries(
		Object.entries(frontmatter).filter(
			([, value]) => !(Array.isArray(value) && value.length === 0) && value !== undefined,
		),
	);
	if (Object.keys(meta).length === 0) return `${body.trim()}\n`;
	const doc = new Document(meta);
	visit(doc, {
		Seq(_key, node) {
			if (isSeq(node)) node.flow = true;
		},
	});
	const header = `---\n${doc.toString({ flowCollectionPadding: false }).trimEnd()}\n---\n`;
	return `${header}${body.trim()}\n`;
}

/** Create, replace, or append to `<vault>/<folder>/<name>.md`. Returns the written note. */
export function writeMemoryNote(vaultDir: string, input: MemoryWriteInput): MemoryNote {
	ensureMemoryVault(vaultDir);
	const folder = normalizeMemoryFolder(input.folder);
	const name = safeSegment(input.name.replace(/\.md$/i, ""), "name");
	const file = join(vaultDir, folder, `${name}.md`);
	const mode = input.mode ?? "create";
	const exists = existsSync(file);
	if (mode === "create" && exists) {
		throw new Error(`Memory already exists: ${toPosix(relative(vaultDir, file))}. Use mode "append" or "replace".`);
	}
	mkdirSync(dirname(file), { recursive: true });
	const existing = exists ? readMemoryNote(vaultDir, file) : undefined;
	const frontmatter: Record<string, unknown> = { ...(existing?.frontmatter ?? {}) };
	delete frontmatter.tag;
	delete frontmatter.person;
	const existingPeople = existing
		? [...toList(existing.frontmatter.people), ...toList(existing.frontmatter.person)]
		: [];
	const tags = input.tags?.map(normalizeTag);
	frontmatter.tags = mode === "replace" && tags ? mergeList([], tags) : mergeList(existing?.tags ?? [], tags);
	frontmatter.people =
		mode === "replace" && input.people ? mergeList([], input.people) : mergeList(existingPeople, input.people);
	const body =
		mode === "append" && existing?.body ? `${existing.body.trimEnd()}\n\n${input.content.trim()}` : input.content;
	writeFileSync(file, renderNote(frontmatter, body));
	return readMemoryNote(vaultDir, file);
}
