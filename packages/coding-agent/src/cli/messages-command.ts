import chalk from "chalk";
import { APP_NAME } from "../config.ts";
import {
	BeeperClient,
	type BeeperConfig,
	DEFAULT_BEEPER_URL,
	getBeeperConfigPath,
	loadBeeperConfig,
	saveBeeperConfig,
} from "../core/messaging/beeper.ts";
import {
	approveDraft,
	buildDecidePrompt,
	CHAT_MODES,
	type Decider,
	findChat,
	introText,
	isChatMode,
	MessagingStore,
	parseDecision,
	pollMessages,
	sendAsBrian,
} from "../core/messaging/gateway.ts";
import { createProcessExecutor } from "../extensions/brian/routine-runner.ts";
import { question, secret } from "./connect-model.ts";

const HELP = `Usage: ${APP_NAME} messages <command>

Brian reads and answers your chats through Beeper Desktop (Discord, WhatsApp, iMessage, Telegram, Signal, ...).

  connect [--token <t>] [--url <u>]        Connect Beeper Desktop (Settings -> Integrations -> API)
  status                                   Connection, default mode, pending drafts
  chats [-n <limit>] [--json]              List recent chats and Brian's mode for each
  read <chat> [--json]                     Show recent messages in a chat
  policy [<chat> <mode>] [--note <text>]   Show or set how Brian treats a chat
  policy --default <mode>                  Set the mode for chats without a policy
  drafts [--json]                          List replies waiting for your approval
  approve <id> [--text <edited reply>]     Send a draft (optionally edited)
  open <id>                                Open the chat in Beeper with the draft in the composer
  dismiss <id>                             Drop a draft
  send <chat> <text> [--as-me]             Send a message through Brian (--as-me: no intro or "sent by brian")
  intro [--name <n>] [--text <t>] [--reset]  Show or change the intro Brian sends before its first message in a chat
  log [--json]                             Everything Brian has sent
  watch [--interval <seconds>] [--once]    Watch for new messages (also: ${APP_NAME} gateway)

Modes: ignore (never look), draft (write replies for approval, default), auto (send confident
replies, draft the rest), brian (your own chat with Brian: your messages there are requests to Brian).
Muted, archived, and low-priority chats are ignored unless they have a policy.
Outside your brian chat, everything Brian sends ends with "- sent by brian", and the first message
in a chat is preceded by a one-time intro.`;

interface Parsed {
	sub: string | undefined;
	positional: string[];
	values: Map<string, string>;
	switches: Set<string>;
}

function parse(args: string[]): Parsed {
	const [sub, ...rest] = args;
	const parsed: Parsed = { sub, positional: [], values: new Map(), switches: new Set() };
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (["--token", "--url", "--note", "--default", "--text", "--interval", "--name", "-n"].includes(arg)) {
			const value = rest[++i];
			if (value === undefined) throw new Error(`${arg} requires a value`);
			parsed.values.set(arg, value);
		} else if (arg.startsWith("-")) parsed.switches.add(arg);
		else parsed.positional.push(arg);
	}
	return parsed;
}

export interface MessagesDeps {
	vaultDir?: string;
	store?: MessagingStore;
	client?: BeeperClient;
	decide?: Decider;
	configFile?: string;
}

function requireClient(deps: MessagesDeps): BeeperClient {
	if (deps.client) return deps.client;
	const config = loadBeeperConfig(deps.configFile);
	if (!config) throw new Error(`Beeper isn't connected. Run ${APP_NAME} connect beeper`);
	return new BeeperClient(config);
}

export function createProcessDecider(): Decider {
	const executor = createProcessExecutor();
	return async (input) => parseDecision(await executor.runTask(buildDecidePrompt(input)));
}

const when = (ms: number) => new Date(ms).toLocaleString();

export async function runConnectBeeper(args: string[], deps: MessagesDeps = {}): Promise<number> {
	const parsed = parse(["connect", ...args]);
	let accessToken = parsed.values.get("--token");
	const baseURL = parsed.values.get("--url") ?? loadBeeperConfig(deps.configFile)?.baseURL ?? DEFAULT_BEEPER_URL;
	if (!accessToken) {
		if (!process.stdin.isTTY) throw new Error("no terminal: pass --token");
		console.log(
			`In Beeper Desktop open Settings -> Integrations, enable the Desktop API, and create an access token.`,
		);
		accessToken = await secret("Beeper access token: ");
		if (!accessToken) throw new Error("no token entered");
		const url = await question(`Beeper API URL [${baseURL}]: `);
		if (url) return finishConnect({ accessToken, baseURL: url }, deps);
	}
	return finishConnect({ accessToken, baseURL }, deps);
}

async function finishConnect(config: BeeperConfig, deps: MessagesDeps): Promise<number> {
	const client = deps.client ?? new BeeperClient(config);
	const accounts = await client.accounts();
	saveBeeperConfig(config, deps.configFile);
	console.log(`${chalk.green("Connected Beeper")} (${accounts.length} account${accounts.length === 1 ? "" : "s"})`);
	console.log(`Saved to ${deps.configFile ?? getBeeperConfigPath()}`);
	console.log(`Next: ${APP_NAME} messages chats, then ${APP_NAME} messages watch`);
	return 0;
}

export async function runMessagesCommand(args: string[], deps: MessagesDeps = {}): Promise<number> {
	let parsed: Parsed;
	try {
		parsed = parse(args);
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		return 1;
	}
	const { sub, positional, values, switches } = parsed;
	if (!sub || sub === "help" || switches.has("--help") || switches.has("-h")) {
		console.log(HELP);
		return 0;
	}
	const store = deps.store ?? new MessagingStore();
	const json = switches.has("--json");
	try {
		switch (sub) {
			case "connect":
				return await runConnectBeeper(args.slice(1), deps);
			case "status": {
				const config = loadBeeperConfig(deps.configFile);
				const data = store.read();
				console.log(
					`Beeper: ${config ? config.baseURL : chalk.yellow(`not connected (${APP_NAME} connect beeper)`)}`,
				);
				console.log(`Default mode: ${data.defaultMode}`);
				console.log(`Chat policies: ${Object.keys(data.policies).length}`);
				console.log(`Pending drafts: ${store.pendingDrafts().length}`);
				console.log(`Last checked: ${data.lastPollAt ? when(Date.parse(data.lastPollAt)) : "never"}`);
				return 0;
			}
			case "chats": {
				const chats = await requireClient(deps).chats(Number(values.get("-n") ?? 30));
				const rows = chats.map((c) => ({ ...c, mode: store.modeFor(c) }));
				if (json) console.log(JSON.stringify(rows, null, 2));
				else
					for (const c of rows)
						console.log(
							`${c.mode.padEnd(6)} ${c.network.padEnd(10)} ${c.title}${c.unreadCount ? chalk.cyan(` (${c.unreadCount})`) : ""}  ${chalk.dim(c.id)}`,
						);
				return 0;
			}
			case "read": {
				if (!positional[0]) throw new Error("read needs <chat>");
				const client = requireClient(deps);
				const chat = findChat(await client.chats(100), positional.join(" "));
				const messages = await client.messages(chat.id);
				if (json) console.log(JSON.stringify(messages, null, 2));
				else
					for (const m of messages)
						console.log(
							`${chalk.dim(m.timestamp)} ${m.isSender ? chalk.green("me") : (m.senderName ?? m.senderID)}: ${m.text ?? `(${m.type})`}`,
						);
				return 0;
			}
			case "policy": {
				const fallback = values.get("--default");
				if (fallback) {
					if (!isChatMode(fallback)) throw new Error(`mode must be one of ${CHAT_MODES.join(", ")}`);
					store.setDefaultMode(fallback);
					console.log(`Default mode: ${fallback}`);
					return 0;
				}
				if (!positional.length) {
					const data = store.read();
					console.log(`default  ${data.defaultMode}`);
					for (const p of Object.values(data.policies))
						console.log(`${p.mode.padEnd(6)} ${p.title}${p.note ? chalk.dim(`  ${p.note}`) : ""}`);
					return 0;
				}
				const mode = positional[positional.length - 1];
				if (positional.length < 2 || !isChatMode(mode))
					throw new Error(`usage: policy <chat> <${CHAT_MODES.join("|")}> [--note <text>]`);
				const chat = findChat(await requireClient(deps).chats(100), positional.slice(0, -1).join(" "));
				store.setPolicy({ chatID: chat.id, title: chat.title, mode, note: values.get("--note") });
				console.log(`${chat.title}: ${mode}`);
				return 0;
			}
			case "drafts": {
				const drafts = store.pendingDrafts();
				if (json) console.log(JSON.stringify(drafts, null, 2));
				else if (!drafts.length) console.log("No drafts.");
				else
					for (const d of drafts) {
						console.log(`${chalk.bold(d.id)}  ${d.chatTitle} (${d.network})  ${chalk.dim(when(d.createdAt))}`);
						console.log(`  ${d.from}: ${d.incoming.replace(/\n/g, "\n  ")}`);
						console.log(`  ${chalk.green("reply")}: ${d.text}`);
						if (d.reason) console.log(chalk.dim(`  ${d.reason}`));
					}
				return 0;
			}
			case "approve": {
				if (!positional[0]) throw new Error("approve needs <id>");
				const draft = await approveDraft(requireClient(deps), store, positional[0], values.get("--text"));
				console.log(`Sent to ${draft.chatTitle}: ${draft.text}`);
				return 0;
			}
			case "open": {
				const draft = positional[0] ? store.getDraft(positional[0]) : undefined;
				if (!draft) throw new Error(`no draft ${positional[0] ?? ""}`);
				await requireClient(deps).focus(draft.chatID, draft.text);
				store.resolveDraft(draft.id, "dismissed");
				console.log(`Opened ${draft.chatTitle} in Beeper with the draft in the composer.`);
				return 0;
			}
			case "dismiss": {
				if (!positional[0]) throw new Error("dismiss needs <id>");
				store.resolveDraft(positional[0], "dismissed");
				console.log(`Dismissed ${positional[0]}`);
				return 0;
			}
			case "send": {
				if (positional.length < 2) throw new Error("send needs <chat> <text>");
				const client = requireClient(deps);
				const chat = findChat(await client.chats(100), positional[0]);
				const text = positional.slice(1).join(" ");
				if (switches.has("--as-me")) {
					await client.send(chat.id, text);
					store.logSent({ chatID: chat.id, chatTitle: chat.title, text, by: "manual" });
				} else await sendAsBrian(client, store, chat, text, { by: "manual", vaultDir: deps.vaultDir });
				console.log(`Sent to ${chat.title}`);
				return 0;
			}
			case "intro": {
				if (switches.has("--reset")) store.setIntro({ ownerName: null, intro: null });
				const name = values.get("--name");
				const text = values.get("--text");
				if (name !== undefined || text !== undefined) store.setIntro({ ownerName: name, intro: text });
				console.log(introText(store, deps.vaultDir));
				console.log(chalk.dim(`Sent before Brian's first message in a chat. {name} is replaced with your name.`));
				return 0;
			}
			case "log": {
				const sent = store.read().sent;
				if (json) console.log(JSON.stringify(sent, null, 2));
				else if (!sent.length) console.log("Nothing sent yet.");
				else
					for (const s of sent)
						console.log(`${chalk.dim(when(s.at))} ${s.by.padEnd(8)} ${s.chatTitle}: ${s.text}`);
				return 0;
			}
			case "watch": {
				const client = requireClient(deps);
				const decide = deps.decide ?? createProcessDecider();
				const interval = Math.max(5, Number(values.get("--interval") ?? 30)) * 1000;
				if (!switches.has("--once")) console.log(`Watching messages every ${interval / 1000}s. Ctrl-C to stop.`);
				for (;;) {
					try {
						const result = await pollMessages(client, store, decide);
						for (const d of result.drafts)
							console.log(
								`${chalk.bold("draft")} ${d.id} ${d.chatTitle}: ${d.text}  ${chalk.dim(`(${APP_NAME} messages approve ${d.id})`)}`,
							);
						if (result.sent) console.log(`${chalk.green("sent")} ${result.sent}`);
						for (const e of result.errors) console.error(chalk.yellow(e));
					} catch (error) {
						console.error(chalk.yellow(error instanceof Error ? error.message : String(error)));
						if (switches.has("--once")) return 1;
					}
					if (switches.has("--once")) return 0;
					await new Promise((resolve) => setTimeout(resolve, interval));
				}
			}
			default:
				console.error(chalk.red(`Unknown messages command: ${sub}`));
				console.log(HELP);
				return 1;
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		return 1;
	}
}
