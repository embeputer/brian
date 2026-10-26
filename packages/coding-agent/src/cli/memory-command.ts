import { readFileSync } from "node:fs";
import chalk from "chalk";
import { APP_NAME, getMemoryDir } from "../config.ts";
import {
	ensureMemoryVault,
	listMemoryFolders,
	listMemoryNotes,
	type MemoryWriteMode,
	resolveMemoryNote,
	searchMemory,
	writeMemoryNote,
} from "../core/memory/vault.ts";

interface MemoryFlags {
	positional: string[];
	folder?: string;
	tags: string[];
	people: string[];
	limit?: number;
	json: boolean;
	long: boolean;
	content?: string;
	mode?: MemoryWriteMode;
	help: boolean;
}

const VALUE_FLAGS = new Set([
	"--folder",
	"-f",
	"--tag",
	"-t",
	"--person",
	"-p",
	"--limit",
	"-n",
	"--content",
	"-c",
	"--mode",
]);

function parseFlags(args: string[]): MemoryFlags {
	const flags: MemoryFlags = { positional: [], tags: [], people: [], json: false, long: false, help: false };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (VALUE_FLAGS.has(arg)) {
			const value = args[++i];
			if (value === undefined) throw new Error(`${arg} requires a value`);
			if (arg === "--folder" || arg === "-f") flags.folder = value;
			else if (arg === "--tag" || arg === "-t") flags.tags.push(...value.split(","));
			else if (arg === "--person" || arg === "-p") flags.people.push(value);
			else if (arg === "--limit" || arg === "-n") flags.limit = Number.parseInt(value, 10);
			else if (arg === "--content" || arg === "-c") flags.content = value;
			else if (arg === "--mode") {
				if (value !== "create" && value !== "replace" && value !== "append") {
					throw new Error(`--mode must be create, replace, or append`);
				}
				flags.mode = value;
			}
		} else if (arg === "--json") flags.json = true;
		else if (arg === "--long" || arg === "-l") flags.long = true;
		else if (arg === "--help" || arg === "-h") flags.help = true;
		else if (arg.startsWith("-") && arg !== "-") throw new Error(`Unknown option: ${arg}`);
		else flags.positional.push(arg);
	}
	return flags;
}

export function memoryHelp(): string {
	return `${chalk.bold("Usage:")} ${APP_NAME} memory <command>

Markdown memory vault at ${getMemoryDir()} (override with BRIAN_MEMORY_DIR).
One note per file: <Folder>/<Name>.md, frontmatter tags and people.

${chalk.bold("Commands:")}
  search [text] [-f folder] [-t tag] [-p person] [-n limit] [-l] [--json]
                              Print paths of matching notes (all filters must match)
  list [-f folder] [--json]   List notes
  folders [--json]            List folders with note counts
  show <note>                 Print a note (Folder/Name, a path, or a unique name)
  add <Folder/Name> [-t tag] [-p person] [-c content | stdin] [--mode create|append|replace]
                              Write a note
  init                        Create the vault with People/ and Agent/
  path                        Print the vault path

${chalk.bold("Examples:")}
  ${APP_NAME} memory search exams --folder School --person "Alex Kim"
  ${APP_NAME} memory add People/"Alex Kim" -t friend -c "Nickname: AK. Studies CS."
`;
}

function readStdin(): string {
	if (process.stdin.isTTY) return "";
	try {
		return readFileSync(0, "utf8");
	} catch {
		return "";
	}
}

/** `brian memory ...`. Returns the process exit code. */
export function runMemoryCommand(args: string[], vaultDir: string = getMemoryDir()): number {
	const [command, ...rest] = args;
	let flags: MemoryFlags;
	try {
		flags = parseFlags(rest);
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		return 1;
	}
	if (!command || command === "help" || command === "--help" || command === "-h" || flags.help) {
		console.log(memoryHelp());
		return 0;
	}
	try {
		switch (command) {
			case "path":
				console.log(vaultDir);
				return 0;
			case "init":
				ensureMemoryVault(vaultDir);
				console.log(vaultDir);
				return 0;
			case "search":
			case "find": {
				const results = searchMemory(vaultDir, {
					text: flags.positional.join(" "),
					folder: flags.folder,
					tags: flags.tags,
					people: flags.people,
					limit: flags.limit,
				});
				if (flags.json) console.log(JSON.stringify(results, null, 2));
				else if (flags.long) {
					for (const r of results) {
						const meta = [
							r.tags.length ? `tags: ${r.tags.join(", ")}` : "",
							r.people.length ? `people: ${r.people.join(", ")}` : "",
						]
							.filter(Boolean)
							.join("  ");
						console.log(`${r.path}\n  ${chalk.dim(meta)}${meta ? "\n  " : ""}${r.snippet}`);
					}
				} else for (const r of results) console.log(r.path);
				return results.length > 0 ? 0 : 1;
			}
			case "list":
			case "ls": {
				const notes = listMemoryNotes(vaultDir, flags.folder);
				if (flags.json) {
					console.log(
						JSON.stringify(
							notes.map(({ name, folder, path, relativePath, tags, people }) => ({
								name,
								folder,
								path,
								relativePath,
								tags,
								people,
							})),
							null,
							2,
						),
					);
				} else for (const note of notes) console.log(note.relativePath);
				return 0;
			}
			case "folders": {
				const folders = listMemoryFolders(vaultDir);
				if (flags.json) console.log(JSON.stringify(folders, null, 2));
				else for (const f of folders) console.log(`${f.folder}\t${f.notes}`);
				return 0;
			}
			case "show":
			case "cat": {
				const ref = flags.positional.join(" ");
				const file = ref ? resolveMemoryNote(vaultDir, ref) : undefined;
				if (!file) {
					console.error(chalk.red(`Error: no memory note matches ${JSON.stringify(ref)}`));
					return 1;
				}
				process.stdout.write(readFileSync(file, "utf8"));
				return 0;
			}
			case "add":
			case "write": {
				const target = flags.positional.join(" ").replace(/\.md$/i, "");
				const slash = target.lastIndexOf("/");
				if (slash <= 0) {
					console.error(chalk.red("Error: add needs <Folder/Name>, e.g. People/Alex Kim"));
					return 1;
				}
				const content = flags.content ?? readStdin();
				const note = writeMemoryNote(vaultDir, {
					folder: target.slice(0, slash),
					name: target.slice(slash + 1),
					content,
					tags: flags.tags,
					people: flags.people,
					mode: flags.mode,
				});
				console.log(note.path);
				return 0;
			}
			default:
				console.error(chalk.red(`Unknown memory command: ${command}`));
				console.error(memoryHelp());
				return 1;
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		return 1;
	}
}
