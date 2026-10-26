import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { AuthInteraction, AuthPrompt, AuthType } from "@brian-agent/ai";
import chalk from "chalk";
import { getAgentDir } from "../config.ts";
import { ModelRuntime } from "../core/model-runtime.ts";
import { SettingsManager } from "../core/settings-manager.ts";

async function question(text: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		return (await rl.question(text)).trim();
	} finally {
		rl.close();
	}
}

/** Read a line without echoing it. */
function secret(text: string): Promise<string> {
	const stdin = process.stdin;
	if (!stdin.isTTY) return question(text);
	process.stdout.write(text);
	return new Promise((resolve, reject) => {
		let value = "";
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");
		const done = (error?: Error) => {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.off("data", onData);
			process.stdout.write("\n");
			if (error) reject(error);
			else resolve(value.trim());
		};
		const onData = (chunk: string) => {
			for (const char of chunk) {
				if (char === "\r" || char === "\n") return done();
				if (char === "\u0003") return done(new Error("cancelled"));
				if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
				else value += char;
			}
		};
		stdin.on("data", onData);
	});
}

async function choose<T extends { id: string; label: string }>(message: string, options: readonly T[]): Promise<T> {
	console.log(`\n${message}`);
	options.forEach((option, index) => {
		console.log(`  ${String(index + 1).padStart(2)}. ${option.label}`);
	});
	for (;;) {
		const answer = await question(`Pick 1-${options.length} or type an id: `);
		const byNumber = options[Number.parseInt(answer, 10) - 1];
		const picked = byNumber ?? options.find((option) => option.id === answer);
		if (picked) return picked;
		console.log(chalk.yellow("Not one of the options."));
	}
}

async function answerPrompt(prompt: AuthPrompt): Promise<string> {
	const hint = "placeholder" in prompt && prompt.placeholder ? ` (${prompt.placeholder})` : "";
	switch (prompt.type) {
		case "select":
			return (await choose(prompt.message, prompt.options)).id;
		case "secret":
			return secret(`${prompt.message}${hint}: `);
		default:
			return question(`${prompt.message}${hint}: `);
	}
}

const interaction: AuthInteraction = {
	prompt: answerPrompt,
	notify(event) {
		switch (event.type) {
			case "auth_url":
				console.log(`\nOpen this URL in your browser:\n${event.url}`);
				if (event.instructions) console.log(event.instructions);
				break;
			case "device_code":
				console.log(`\nOpen ${event.verificationUri} and enter code ${chalk.bold(event.userCode)}`);
				break;
			default:
				console.log(event.message);
		}
	},
};

function deviceId(): string {
	const file = join(getAgentDir(), "installation-id");
	if (existsSync(file)) return readFileSync(file, "utf8").trim();
	const id = randomUUID();
	mkdirSync(getAgentDir(), { recursive: true });
	writeFileSync(file, `${id}\n`, { mode: 0o600 });
	return id;
}

export function saveDefaultModel(ref: string): Promise<void> {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) throw new Error("expected <provider>/<model id>");
	const settings = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
	settings.setDefaultModelAndProvider(ref.slice(0, slash), ref.slice(slash + 1));
	return settings.flush();
}

/**
 * Interactive: pick a provider, log in (API key or subscription) unless it is already configured,
 * then pick a default model. Returns the saved `<provider>/<model id>`.
 */
export async function connectModel(providerHint?: string): Promise<string> {
	const runtime = await ModelRuntime.create();
	const providers = [...runtime.getProviders()].filter((p) => runtime.getModels(p.id).length > 0);
	const configured = new Set((await runtime.getAvailable()).map((m) => m.provider));
	const options = providers
		.map((p) => ({
			id: p.id,
			label: `${p.name}${configured.has(p.id) ? chalk.green("  (connected)") : ""}`,
			provider: p,
		}))
		.sort((a, b) => Number(configured.has(b.id)) - Number(configured.has(a.id)) || a.label.localeCompare(b.label));
	const picked =
		(providerHint && options.find((o) => o.id === providerHint)) || (await choose("Which model provider?", options));
	const provider = picked.provider;

	if (!configured.has(provider.id)) {
		const methods: Array<{ id: AuthType; label: string }> = [];
		if (provider.auth.oauth) methods.push({ id: "oauth", label: `Log in: ${provider.auth.oauth.name}` });
		if (provider.auth.apiKey?.login) methods.push({ id: "api_key", label: `API key: ${provider.auth.apiKey.name}` });
		if (methods.length === 0)
			throw new Error(`${provider.name} has no interactive login; set its environment variables`);
		const method = methods.length === 1 ? methods[0] : await choose("How do you want to connect?", methods);
		await runtime.login(provider.id, method.id, interaction, { getDeviceId: deviceId });
		console.log(chalk.green(`Connected ${provider.name}.`));
	}

	const available = await runtime.getAvailable(provider.id);
	const models = (available.length ? available : runtime.getModels(provider.id)).map((m) => ({
		id: m.id,
		label: m.name && m.name !== m.id ? `${m.id}  ${chalk.dim(m.name)}` : m.id,
	}));
	const model = await choose(`Default ${provider.name} model?`, models.slice(0, 30));
	const ref = `${provider.id}/${model.id}`;
	await saveDefaultModel(ref);
	return ref;
}
