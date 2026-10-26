import {
	type A2aPeerRecord,
	defaultA2aDiscoveryDir,
	delegateToA2aAgentPreferStream,
	LocalA2aDiscovery,
} from "@brian-agent/a2a";
import type { AgentMessage } from "@brian-agent/agent";
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
	return Boolean(env.SANDBOX_NAME?.trim());
}

export function brianSandboxName(env: NodeJS.ProcessEnv = process.env): string {
	const named = env.SANDBOX_NAME || env.BRIAN_SERVER_USERNAME || env.OPENCODE_SERVER_USERNAME;
	if (named?.trim()) return named.trim();
	return `brian-${process.pid}`;
}

export function formatA2aPeers(peers: readonly A2aPeerRecord[]): string {
	if (peers.length === 0) return "No other brian sandboxes discovered on this machine.";
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
			content: `Local brian sandboxes reachable over A2A:\n${formatA2aPeers(peers)}`,
			display: false,
			timestamp: Date.now(),
		};
		return { messages: [...event.messages, message] };
	});

	brian.registerTool({
		name: "a2a",
		label: "Brian A2A",
		description:
			"Discover and message other brian sandboxes on this machine over A2A. Use list to see peers, send to delegate a task by sandbox name.",
		promptSnippet: "Talk to other local brian sandboxes over A2A",
		promptGuidelines: [
			"Use a2a with action=list to see brian sandboxes on this machine.",
			"Use a2a with action=send to ask a named local sandbox to do work.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("send")]),
			name: Type.Optional(Type.String({ description: "Sandbox name, for send" })),
			task: Type.Optional(Type.String({ description: "Work to send to the peer sandbox" })),
		}),
		async execute(_toolCallId, args, signal, onUpdate) {
			if (args.action === "list") {
				const peers = discovery.list();
				return { content: [{ type: "text", text: formatA2aPeers(peers) }], details: { peers } };
			}
			if (!args.name?.trim()) throw new Error("name is required to send");
			if (!args.task?.trim()) throw new Error("task is required to send");
			const peer = discovery.find(args.name);
			if (!peer) throw new Error(`No local brian sandbox named "${args.name.trim()}"`);
			const result = await delegateToA2aAgentPreferStream({ url: peer.url, task: args.task, signal }, (text) => {
				onUpdate?.({
					content: [{ type: "text", text }],
					details: { peer },
				});
			});
			if (result.failed) {
				return {
					content: [{ type: "text", text: result.error ?? "A2A send failed" }],
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
