import { execFileSync } from "node:child_process";
import {
	type A2aPeerRecord,
	defaultA2aDiscoveryDir,
	delegateToA2aAgentPreferStream,
	LocalA2aDiscovery,
} from "@brian-agent/a2a";
import type { AgentMessage } from "@brian-agent/agent";
import { StringEnum } from "@brian-agent/ai";
import { Type } from "typebox";

import type { ExtensionAPI } from "../../core/extensions/types.ts";

export interface InstallBrianA2aOptions {
	env?: NodeJS.ProcessEnv;
	discovery?: LocalA2aDiscovery;
}

function isTruthy(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.toLowerCase();
	return value === "1" || normalized === "true" || normalized === "yes";
}

function isDisabled(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.toLowerCase();
	return value === "0" || normalized === "false" || normalized === "no";
}

export function isBrianA2aEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (isDisabled(env.BRIAN_A2A)) return false;
	if (isTruthy(env.BRIAN_A2A)) return true;
	return Boolean(env.BRIAN_NAME?.trim() || env.SANDBOX_NAME?.trim());
}

export function brianPeerName(env: NodeJS.ProcessEnv = process.env): string {
	const named = env.BRIAN_NAME || env.SANDBOX_NAME;
	if (named?.trim()) return named.trim();
	return `brian-${process.pid}`;
}

export function formatA2aPeers(peers: readonly A2aPeerRecord[]): string {
	if (peers.length === 0) return "No other Brians discovered on this machine.";
	return peers
		.map((peer) => {
			const cwd = peer.cwd ? ` cwd=${peer.cwd}` : "";
			return `${peer.name} ${peer.url}${cwd}`;
		})
		.join("\n");
}

let sharedDiscovery: LocalA2aDiscovery | undefined;

export function brianA2aDiscovery(env: NodeJS.ProcessEnv = process.env): LocalA2aDiscovery {
	sharedDiscovery ??= new LocalA2aDiscovery({ dir: defaultA2aDiscoveryDir(env) });
	return sharedDiscovery;
}

export function installA2a(brian: ExtensionAPI, options: InstallBrianA2aOptions = {}): void {
	const env = options.env ?? process.env;
	if (!isBrianA2aEnabled(env)) return;

	const discovery = options.discovery ?? brianA2aDiscovery(env);

	brian.on("context", (event) => {
		const peers = discovery.list();
		if (peers.length === 0) return;
		const message: AgentMessage = {
			role: "custom",
			customType: "brian-a2a-peers",
			content: `Other Brians reachable with the brians tool:\n${formatA2aPeers(peers)}`,
			display: false,
			timestamp: Date.now(),
		};
		return { messages: [...event.messages, message] };
	});

	brian.registerTool({
		name: "brians",
		label: "Other Brians",
		description:
			"Talk to other Brian agents on this machine (yours or other people's). list shows peers; send delegates a task and returns the reply; review sends a git diff from a workspace and asks the peer to approve it or request changes.",
		promptSnippet: "Message, delegate to, or ask for review from other Brian agents",
		promptGuidelines: [
			"Use brians with action=list to see other Brians before sending.",
			"Use brians with action=send to hand a self-contained task to another Brian by name.",
			"Use brians with action=review to get a second Brian to check changes before you call them done.",
		],
		parameters: Type.Object({
			action: StringEnum(["list", "send", "review"] as const),
			name: Type.Optional(Type.String({ description: "Peer Brian name, for send and review" })),
			task: Type.Optional(Type.String({ description: "Task to send, or what the reviewer should focus on" })),
			workspace: Type.Optional(
				Type.String({ description: "Git workspace to review; defaults to the current directory" }),
			),
			base: Type.Optional(
				Type.String({ description: "Base ref for review; defaults to the working tree diff against HEAD" }),
			),
		}),
		async execute(_toolCallId, args, signal, onUpdate) {
			if (args.action === "list") {
				const peers = discovery.list();
				return { content: [{ type: "text", text: formatA2aPeers(peers) }], details: { peers } };
			}
			if (!args.name?.trim()) throw new Error(`name is required for ${args.action}`);
			const peer = discovery.find(args.name);
			if (!peer) throw new Error(`No Brian named "${args.name.trim()}" on this machine`);
			let task = args.task?.trim() ?? "";
			if (args.action === "review") {
				task = buildReviewTask(args.workspace ?? process.cwd(), args.base, task);
			} else if (!task) {
				throw new Error("task is required to send");
			}
			const result = await delegateToA2aAgentPreferStream({ url: peer.url, task, signal }, (text) => {
				onUpdate?.({
					content: [{ type: "text", text }],
					details: { peer },
				});
			});
			if (result.failed) {
				return {
					content: [{ type: "text", text: result.error ?? "Message to peer failed" }],
					details: { peer, failed: true, error: result.error },
				};
			}
			return {
				content: [{ type: "text", text: result.text || "(empty response)" }],
				details: { peer },
			};
		},
	});
}

const MAX_REVIEW_DIFF = 60_000;

export function buildReviewTask(workspace: string, base: string | undefined, focus: string): string {
	const diffArgs = base ? ["diff", `${base}...HEAD`] : ["diff", "HEAD"];
	let diff: string;
	try {
		diff = execFileSync("git", ["-C", workspace, ...diffArgs], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	} catch (error) {
		throw new Error(`git ${diffArgs.join(" ")} failed in ${workspace}: ${(error as Error).message}`);
	}
	if (!diff.trim()) throw new Error(`No changes to review in ${workspace}`);
	const clipped = diff.length > MAX_REVIEW_DIFF ? `${diff.slice(0, MAX_REVIEW_DIFF)}\n... (diff truncated)` : diff;
	return [
		"Review this change from another Brian. Reply with APPROVE or CHANGES on the first line, then specific findings.",
		`Workspace: ${workspace}${base ? ` (compared with ${base})` : ""}`,
		focus ? `Focus: ${focus}` : "",
		"```diff",
		clipped,
		"```",
	]
		.filter(Boolean)
		.join("\n");
}
