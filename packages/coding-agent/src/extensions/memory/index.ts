import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringEnum } from "@brian-agent/ai";
import { Type } from "typebox";
import { APP_NAME, getMemoryDir } from "../../config.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";
import {
	ensureMemoryVault,
	listMemoryFolders,
	listMemoryNotes,
	searchMemory,
	writeMemoryNote,
} from "../../core/memory/vault.ts";

const MAX_AGENT_NOTES_CHARS = 8_000;

function agentNotes(vaultDir: string): string {
	const parts: string[] = [];
	let used = 0;
	for (const note of listMemoryNotes(vaultDir, "Agent")) {
		const body = note.body.trim();
		if (!body) continue;
		const block = `## ${note.relativePath}\n${body}`;
		if (used + block.length > MAX_AGENT_NOTES_CHARS) break;
		parts.push(block);
		used += block.length;
	}
	return parts.join("\n\n");
}

export function buildMemoryPromptSection(vaultDir: string): string {
	const folders = listMemoryFolders(vaultDir)
		.map((f) => `${f.folder} (${f.notes})`)
		.join(", ");
	const agent = agentNotes(vaultDir);
	return `Your memory vault is ${vaultDir}: plain markdown, one memory per file at <Folder>/<Name>.md. Folders: ${folders || "none yet"}.
- People/: one note per person. Name the file with their full name. Keep nicknames as \`aliases\` frontmatter, and occupation, email, phone, and a description in the body
- Agent/: your own personality and how your user wants you to act. It is loaded below
- create other folders as needed (Work, School, Life, Relationships, ...). Keep folder names short and Title Case
- frontmatter: \`tags\` for topics, \`people\` for the full names of people the memory is about. \`[[Full Name]]\` in the body also links a person
- before answering anything personal, search memory first (memory_search, or \`${APP_NAME} memory search\` in bash). Read the files it returns
- when you learn something durable about your user, the people around them, or how they want things done, save it with memory_write. Append to existing notes instead of making duplicates
- do not store secrets (passwords, tokens, card numbers) in memory${agent ? `\n\n${agent}` : ""}`;
}

export default function memoryExtension(brian: ExtensionAPI): void {
	const vaultDir = (): string => getMemoryDir();

	brian.on("before_agent_start", (event) => {
		const dir = vaultDir();
		try {
			ensureMemoryVault(dir);
			event.systemPromptOptions.sections.memory = buildMemoryPromptSection(dir);
		} catch {
			// A read-only or missing home should not stop the run.
		}
	});

	brian.registerTool({
		name: "memory_search",
		label: "Search memory",
		description:
			"Search the markdown memory vault by text, folder, tag, and person. All given filters must match. Returns file paths with a snippet; read the files for full content.",
		promptSnippet: "Search your memory vault (people, work, school, life notes)",
		parameters: Type.Object({
			text: Type.Optional(
				Type.String({ description: "Words that must all appear in the note name, tags, people, or body" }),
			),
			folder: Type.Optional(Type.String({ description: "Folder to search, e.g. People or Work" })),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Tags the note must have" })),
			people: Type.Optional(Type.Array(Type.String(), { description: "People the note must be linked to" })),
			limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
		}),
		async execute(_toolCallId, args) {
			const results = searchMemory(vaultDir(), { ...args, limit: args.limit ?? 20 });
			const text = results.length
				? results
						.map((r) => {
							const meta = [
								r.tags.length ? `tags: ${r.tags.join(", ")}` : "",
								r.people.length ? `people: ${r.people.join(", ")}` : "",
							]
								.filter(Boolean)
								.join("; ");
							return `${r.path}${meta ? `\n  ${meta}` : ""}${r.snippet ? `\n  ${r.snippet}` : ""}`;
						})
						.join("\n")
				: "No matching memories.";
			return { content: [{ type: "text" as const, text }], details: { results } };
		},
	});

	brian.registerTool({
		name: "memory_write",
		label: "Write memory",
		description:
			"Create, append to, or replace a memory note at <folder>/<name>.md in the vault. Tags and people are merged into the note's frontmatter unless mode is replace.",
		promptSnippet: "Save durable facts about your user and the people around them",
		parameters: Type.Object({
			folder: Type.String({ description: "Folder, e.g. People, Agent, Work, School/Calculus" }),
			name: Type.String({
				description: "Memory name, used as the file name (a person's full name for People notes)",
			}),
			content: Type.String({ description: "Markdown body" }),
			tags: Type.Optional(Type.Array(Type.String())),
			people: Type.Optional(Type.Array(Type.String({ description: "Full names of linked people" }))),
			mode: Type.Optional(
				StringEnum(["create", "append", "replace"] as const, {
					description: "Default: append if the note exists, else create",
				}),
			),
		}),
		async execute(_toolCallId, args) {
			const dir = vaultDir();
			const exists = existsSync(join(dir, args.folder, `${args.name.replace(/\.md$/i, "")}.md`));
			const note = writeMemoryNote(dir, { ...args, mode: args.mode ?? (exists ? "append" : "create") });
			return {
				content: [
					{
						type: "text" as const,
						text: `${exists ? "Updated" : "Created"} ${note.path}\n\n${readFileSync(note.path, "utf8")}`,
					},
				],
				details: { path: note.path },
			};
		},
	});
}
