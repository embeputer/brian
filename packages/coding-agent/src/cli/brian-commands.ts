/**
 * Brian lifecycle commands: setup/onboard, doctor, status, model, skill, and uninstall.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import {
	APP_NAME,
	CONFIG_DIR_NAME,
	getAgentDir,
	getAuthPath,
	getMemoryDir,
	getSessionsDir,
	getSettingsPath,
	VERSION,
} from "../config.ts";
import { ensureMemoryVault, listMemoryNotes, writeMemoryNote } from "../core/memory/vault.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { loadSkills } from "../core/skills.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { runAuditCommand } from "./audit-command.ts";
import { runRoutinesCommand } from "./routines-command.ts";

export const BRIAN_COMMANDS = [
	"setup",
	"onboard",
	"doctor",
	"status",
	"model",
	"skill",
	"skills",
	"routines",
	"routine",
	"cron",
	"audit",
	"uninstall",
] as const;

interface Flags {
	positional: string[];
	values: Map<string, string>;
	switches: Set<string>;
}

function parseFlags(args: string[], valueFlags: string[]): Flags {
	const flags: Flags = { positional: [], values: new Map(), switches: new Set() };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (valueFlags.includes(arg)) {
			const value = args[++i];
			if (value === undefined) throw new Error(`${arg} requires a value`);
			flags.values.set(arg, value);
		} else if (arg.startsWith("-")) flags.switches.add(arg);
		else flags.positional.push(arg);
	}
	return flags;
}

function fail(message: string): number {
	console.error(chalk.red(`Error: ${message}`));
	return 1;
}

function isHelp(flags: Flags): boolean {
	return flags.switches.has("--help") || flags.switches.has("-h");
}

// setup / onboard

async function ask(question: string, fallback?: string): Promise<string | undefined> {
	if (!process.stdin.isTTY) return fallback;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await rl.question(`${question}${fallback ? ` (${fallback})` : ""}: `)).trim();
		return answer || fallback;
	} finally {
		rl.close();
	}
}

export interface OnboardAnswers {
	name?: string;
	nickname?: string;
	email?: string;
	occupation?: string;
	about?: string;
	voice?: string;
}

/** Create ~/.brian, the memory vault, and the user's People/ and Agent/ notes. Returns written paths. */
export function onboard(answers: OnboardAnswers, memoryDir: string = getMemoryDir()): string[] {
	mkdirSync(getAgentDir(), { recursive: true });
	ensureMemoryVault(memoryDir);
	const written: string[] = [];
	if (answers.name) {
		const lines = [
			answers.occupation ? `Occupation: ${answers.occupation}` : "",
			answers.email ? `Email: ${answers.email}` : "",
			answers.about ?? "",
		].filter(Boolean);
		const note = writeMemoryNote(memoryDir, {
			folder: "People",
			name: answers.name,
			content: lines.join("\n") || "My user.",
			tags: ["me"],
			mode: existsSync(join(memoryDir, "People", `${answers.name}.md`)) ? "append" : "create",
		});
		if (answers.nickname) {
			const raw = readFileSync(note.path, "utf8");
			if (!/^aliases:/m.test(raw))
				writeFileSync(note.path, raw.replace(/^---\n/, `---\naliases: [${answers.nickname}]\n`));
		}
		written.push(note.path);
		written.push(
			writeMemoryNote(memoryDir, {
				folder: "Agent",
				name: "User",
				content: `My user is [[${answers.name}]]. When I act or write for them, I speak as them.`,
				tags: ["identity"],
				mode: "replace",
			}).path,
		);
	}
	if (answers.voice) {
		written.push(
			writeMemoryNote(memoryDir, {
				folder: "Agent",
				name: "Personality",
				content: answers.voice,
				tags: ["personality"],
				mode: "replace",
			}).path,
		);
	}
	return written;
}

async function runOnboard(command: string, args: string[]): Promise<number> {
	const flags = parseFlags(args, ["--name", "--nickname", "--email", "--occupation", "--about", "--voice"]);
	if (isHelp(flags)) {
		console.log(`Usage: ${APP_NAME} ${command} [--name <full name>] [--nickname <n>] [--email <e>] [--occupation <o>] [--about <text>] [--voice <text>] [--yes]

Creates ${join(homedir(), CONFIG_DIR_NAME)}, the memory vault, a People/ note for you, and Agent/ notes for how Brian should sound.
Prompts for missing answers when run in a terminal; --yes skips the prompts.`);
		return 0;
	}
	const interactive = !flags.switches.has("--yes") && !flags.switches.has("-y");
	const get = async (flag: string, question: string): Promise<string | undefined> =>
		flags.values.get(flag) ?? (interactive ? await ask(question) : undefined);
	const answers: OnboardAnswers = {
		name: await get("--name", "Your full name"),
		nickname: await get("--nickname", "What people call you"),
		email: await get("--email", "Email"),
		occupation: await get("--occupation", "What you do (work, school, ...)"),
		about: await get("--about", "Anything Brian should know about you"),
		voice: await get("--voice", "How should Brian sound when it talks or writes for you"),
	};
	const written = onboard(answers);
	console.log(`${chalk.green("Brian is set up.")} Memory: ${getMemoryDir()}`);
	for (const path of written) console.log(`  wrote ${path}`);
	console.log(`\nNext:
  ${APP_NAME} doctor                 check providers, paths, and memory
  ${APP_NAME} model <provider/id>    pick a default model
  ${APP_NAME} "plan my week"         talk to Brian`);
	return 0;
}

// doctor / status

interface Check {
	ok: boolean;
	label: string;
	detail: string;
}

function nodeVersionOk(): boolean {
	const [major, minor] = process.versions.node.split(".").map(Number);
	return major > 22 || (major === 22 && minor >= 19);
}

const PROVIDER_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENROUTER_API_KEY",
	"GEMINI_API_KEY",
	"XAI_API_KEY",
	"GROQ_API_KEY",
	"MISTRAL_API_KEY",
	"ZAI_API_KEY",
];

export function runDoctorChecks(cwd: string = process.cwd()): Check[] {
	const agentDir = getAgentDir();
	const memoryDir = getMemoryDir();
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const envKeys = PROVIDER_ENV_KEYS.filter((key) => process.env[key]);
	const hasAuthFile = existsSync(getAuthPath());
	const model = settings.getDefaultModel();
	const provider = settings.getDefaultProvider();
	const skills = loadSkills({ cwd, agentDir, skillPaths: [], includeDefaults: true });
	return [
		{ ok: nodeVersionOk(), label: "node", detail: `${process.versions.node} (needs >=22.19.0)` },
		{
			ok: existsSync(agentDir),
			label: "config",
			detail: existsSync(agentDir) ? agentDir : `${agentDir} missing, run ${APP_NAME} setup`,
		},
		{
			ok: existsSync(join(memoryDir, "People")) && existsSync(join(memoryDir, "Agent")),
			label: "memory",
			detail: existsSync(memoryDir)
				? `${memoryDir} (${listMemoryNotes(memoryDir).length} notes)`
				: `${memoryDir} missing, run ${APP_NAME} setup`,
		},
		{
			ok: envKeys.length > 0 || hasAuthFile,
			label: "providers",
			detail:
				[envKeys.length ? `env: ${envKeys.join(", ")}` : "", hasAuthFile ? `auth: ${getAuthPath()}` : ""]
					.filter(Boolean)
					.join("; ") || "no API keys in env and no auth.json",
		},
		{
			ok: true,
			label: "model",
			detail: model ? `${provider ? `${provider}/` : ""}${model}` : "default (set with brian model)",
		},
		{
			ok: skills.diagnostics.filter((d) => d.type === "error").length === 0,
			label: "skills",
			detail: `${skills.skills.length} loaded${skills.diagnostics.length ? `, ${skills.diagnostics.length} warnings` : ""}`,
		},
	];
}

function runDoctor(): number {
	const checks = runDoctorChecks();
	for (const check of checks) {
		console.log(`${check.ok ? chalk.green("ok  ") : chalk.red("fail")} ${check.label.padEnd(10)} ${check.detail}`);
	}
	return checks.every((c) => c.ok) ? 0 : 1;
}

function countFiles(dir: string, suffix: string): number {
	if (!existsSync(dir)) return 0;
	let count = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) count += countFiles(join(dir, entry.name), suffix);
		else if (entry.name.endsWith(suffix)) count++;
	}
	return count;
}

function runStatus(args: string[]): number {
	const flags = parseFlags(args, []);
	const settings = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
	const status = {
		version: VERSION,
		agentDir: getAgentDir(),
		settings: getSettingsPath(),
		memory: getMemoryDir(),
		memoryNotes: existsSync(getMemoryDir()) ? listMemoryNotes(getMemoryDir()).length : 0,
		sessions: countFiles(getSessionsDir(), ".jsonl"),
		skills: loadSkills({ cwd: process.cwd(), agentDir: getAgentDir(), skillPaths: [], includeDefaults: true }).skills
			.length,
		defaultProvider: settings.getDefaultProvider() ?? null,
		defaultModel: settings.getDefaultModel() ?? null,
	};
	if (flags.switches.has("--json")) console.log(JSON.stringify(status, null, 2));
	else for (const [key, value] of Object.entries(status)) console.log(`${key.padEnd(16)} ${value ?? "-"}`);
	return 0;
}

// model

async function runModel(args: string[]): Promise<number> {
	const flags = parseFlags(args, []);
	if (isHelp(flags)) {
		console.log(`Usage: ${APP_NAME} model [<provider>/<model id>]

Without an argument, prints the default model. With one, saves it to ${getSettingsPath()}.
List models with ${APP_NAME} --list-models.`);
		return 0;
	}
	const settings = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
	const [ref] = flags.positional;
	if (!ref) {
		const model = settings.getDefaultModel();
		console.log(model ? `${settings.getDefaultProvider() ?? "?"}/${model}` : "(not set)");
		return 0;
	}
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1)
		return fail("expected <provider>/<model id>, e.g. anthropic/claude-sonnet-4-5");
	settings.setDefaultModelAndProvider(ref.slice(0, slash), ref.slice(slash + 1));
	await settings.flush();
	console.log(`Default model: ${ref}`);
	return 0;
}

// skill

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;

function userSkillsDir(): string {
	return join(getAgentDir(), "skills");
}

function skillNameFromFile(file: string, fallback: string): string {
	try {
		const { frontmatter } = parseFrontmatter<{ name?: unknown }>(readFileSync(file, "utf8"));
		if (typeof frontmatter.name === "string" && frontmatter.name.trim()) return frontmatter.name.trim();
	} catch {}
	return fallback;
}

/** Install a skill directory (with SKILL.md) or a single markdown file into ~/.brian/agent/skills/<name>. */
export function addSkill(source: string, skillsDir: string = userSkillsDir(), force = false): string {
	const src = resolve(source);
	if (!existsSync(src)) throw new Error(`not found: ${source}`);
	const isDir = statSync(src).isDirectory();
	const skillFile = isDir ? join(src, "SKILL.md") : src;
	if (!existsSync(skillFile)) throw new Error(`${source} has no SKILL.md`);
	const fallback =
		isDir || basename(src) === "SKILL.md"
			? basename(isDir ? src : dirname(src))
			: basename(src).replace(/\.md$/i, "");
	const name = skillNameFromFile(skillFile, fallback);
	if (!SKILL_NAME.test(name))
		throw new Error(`invalid skill name ${JSON.stringify(name)}: use lowercase letters, digits, and -`);
	const target = join(skillsDir, name);
	if (existsSync(target) && !force) throw new Error(`skill ${name} already exists (use --force to replace)`);
	rmSync(target, { recursive: true, force: true });
	mkdirSync(skillsDir, { recursive: true });
	if (isDir) cpSync(src, target, { recursive: true });
	else {
		mkdirSync(target, { recursive: true });
		cpSync(src, join(target, "SKILL.md"));
	}
	return target;
}

export function createSkill(name: string, description: string, skillsDir: string = userSkillsDir()): string {
	if (!SKILL_NAME.test(name))
		throw new Error(`invalid skill name ${JSON.stringify(name)}: use lowercase letters, digits, and -`);
	const target = join(skillsDir, name);
	if (existsSync(target)) throw new Error(`skill ${name} already exists`);
	mkdirSync(target, { recursive: true });
	writeFileSync(
		join(target, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\nSteps Brian should follow for this skill.\n`,
	);
	return join(target, "SKILL.md");
}

function runSkill(args: string[]): number {
	const [sub, ...rest] = args;
	const flags = parseFlags(rest, ["--description", "-d"]);
	const help = `Usage: ${APP_NAME} skill <command>

  list [--json]                 List loaded skills (user, project, packages)
  show <name>                   Print a skill's SKILL.md
  add <dir|file.md> [--force]   Install a skill into ${userSkillsDir()}
  new <name> -d <description>   Scaffold a new user skill
  remove <name>                 Delete a user skill`;
	if (!sub || sub === "help" || sub === "--help" || sub === "-h" || isHelp(flags)) {
		console.log(help);
		return 0;
	}
	try {
		const loaded = (): ReturnType<typeof loadSkills>["skills"] =>
			loadSkills({ cwd: process.cwd(), agentDir: getAgentDir(), skillPaths: [], includeDefaults: true }).skills;
		switch (sub) {
			case "list":
			case "ls": {
				const skills = loaded();
				if (flags.switches.has("--json")) {
					console.log(
						JSON.stringify(
							skills.map(({ name, description, filePath }) => ({ name, description, filePath })),
							null,
							2,
						),
					);
				} else for (const s of skills) console.log(`${s.name.padEnd(24)} ${s.description}`);
				return 0;
			}
			case "show": {
				const skill = loaded().find((s) => s.name === flags.positional[0]);
				if (!skill) return fail(`no skill named ${flags.positional[0] ?? ""}`);
				process.stdout.write(readFileSync(skill.filePath, "utf8"));
				return 0;
			}
			case "add":
			case "install": {
				if (!flags.positional[0]) return fail("add needs a skill directory or .md file");
				console.log(addSkill(flags.positional[0], userSkillsDir(), flags.switches.has("--force")));
				return 0;
			}
			case "new":
			case "create": {
				const description = flags.values.get("--description") ?? flags.values.get("-d");
				if (!flags.positional[0] || !description) return fail("new needs <name> and --description");
				console.log(createSkill(flags.positional[0], description));
				return 0;
			}
			case "remove":
			case "rm": {
				const name = flags.positional[0];
				if (!name || !SKILL_NAME.test(name)) return fail("remove needs a skill name");
				const target = join(userSkillsDir(), name);
				if (!existsSync(target)) return fail(`no user skill named ${name} in ${userSkillsDir()}`);
				rmSync(target, { recursive: true, force: true });
				console.log(`Removed ${target}`);
				return 0;
			}
			default:
				console.error(help);
				return 1;
		}
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
}

// uninstall

/** `brian uninstall` with no source removes Brian's data; with a source it stays the package `remove` alias. */
export function isSelfUninstall(args: string[]): boolean {
	return (
		args[0] === "uninstall" && args.slice(1).every((arg) => arg.startsWith("-") && !["-l", "--local"].includes(arg))
	);
}

function runUninstall(args: string[]): number {
	const flags = parseFlags(args, []);
	const root = join(homedir(), CONFIG_DIR_NAME);
	if (isHelp(flags)) {
		console.log(`Usage: ${APP_NAME} uninstall [--keep-memory] --yes
       ${APP_NAME} uninstall <source> [-l]   Remove an extension package (alias for remove)

Deletes ${root} (settings, auth, sessions, skills${flags.switches.has("--keep-memory") ? "" : ", memory"}).
Remove the CLI itself with: npm uninstall -g @brian-agent/cli`);
		return 0;
	}
	const keepMemory = flags.switches.has("--keep-memory");
	if (!flags.switches.has("--yes") && !flags.switches.has("-y")) {
		console.log(
			`This deletes ${keepMemory ? `${root} except ${getMemoryDir()}` : root}. Re-run with --yes to confirm.`,
		);
		return 1;
	}
	if (!existsSync(root)) {
		console.log(`Nothing to remove: ${root} does not exist.`);
		return 0;
	}
	const memory = resolve(getMemoryDir());
	for (const entry of readdirSync(root)) {
		const full = resolve(root, entry);
		if (keepMemory && full === memory) continue;
		rmSync(full, { recursive: true, force: true });
	}
	if (!keepMemory || !existsSync(memory)) rmSync(root, { recursive: true, force: true });
	console.log(
		`Removed ${keepMemory ? `${root} (kept memory)` : root}.\nRemove the CLI with: npm uninstall -g @brian-agent/cli`,
	);
	return 0;
}

/** Dispatch Brian lifecycle commands. Returns an exit code, or undefined when `args` is not one of them. */
export async function runBrianCommand(args: string[]): Promise<number | undefined> {
	const [command, ...rest] = args;
	switch (command) {
		case "setup":
		case "onboard":
			return runOnboard(command, rest);
		case "doctor":
			return runDoctor();
		case "status":
			return runStatus(rest);
		case "model":
			return runModel(rest);
		case "skill":
		case "skills":
			return runSkill(rest);
		case "audit":
			return runAuditCommand(rest);
		case "routines":
		case "routine":
		case "cron":
			return runRoutinesCommand(rest);
		case "uninstall":
			return isSelfUninstall(args) ? runUninstall(rest) : undefined;
		default:
			return undefined;
	}
}
