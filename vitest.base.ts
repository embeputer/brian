import { fileURLToPath } from "node:url";

export const workspaceSourcePaths = {
	chordIndex: fileURLToPath(new URL("./packages/chord/src/index.ts", import.meta.url)),
	chordContext: fileURLToPath(new URL("./packages/chord/src/context/index.ts", import.meta.url)),
	chordDelta: fileURLToPath(new URL("./packages/chord/src/delta/index.ts", import.meta.url)),
	chordBundler: fileURLToPath(new URL("./packages/chord/src/bundler.ts", import.meta.url)),
	chordNode: fileURLToPath(new URL("./packages/chord/src/node.ts", import.meta.url)),
	telemetryIndex: fileURLToPath(new URL("./packages/telemetry/src/index.ts", import.meta.url)),
	telemetryTesting: fileURLToPath(new URL("./packages/telemetry/src/testing/index.ts", import.meta.url)),
	aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
	aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
	aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
	aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	agentNode: fileURLToPath(new URL("./packages/agent/src/node.ts", import.meta.url)),
	protocolIndex: fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
	clientIndex: fileURLToPath(new URL("./packages/client/src/index.ts", import.meta.url)),
	clientUnix: fileURLToPath(new URL("./packages/client/src/unix.ts", import.meta.url)),
	serverIndex: fileURLToPath(new URL("./packages/server/src/index.ts", import.meta.url)),
	serverUnix: fileURLToPath(new URL("./packages/server/src/transports/unix/index.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
	a2aIndex: fileURLToPath(new URL("./packages/a2a/src/index.ts", import.meta.url)),
} as const;

export default {
	resolve: {
		alias: [
			{ find: /^@punch-bot\/chord$/, replacement: workspaceSourcePaths.chordIndex },
			{ find: /^@punch-bot\/chord\/context$/, replacement: workspaceSourcePaths.chordContext },
			{ find: /^@punch-bot\/chord\/delta$/, replacement: workspaceSourcePaths.chordDelta },
			{ find: /^@punch-bot\/chord\/bundler$/, replacement: workspaceSourcePaths.chordBundler },
			{ find: /^@punch-bot\/chord\/node$/, replacement: workspaceSourcePaths.chordNode },
			{ find: /^@punch-bot\/telemetry$/, replacement: workspaceSourcePaths.telemetryIndex },
			{ find: /^@punch-bot\/telemetry\/testing$/, replacement: workspaceSourcePaths.telemetryTesting },
			{ find: /^@punch-bot\/ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@punch-bot\/ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@punch-bot\/ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@punch-bot\/ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{
				find: /^@punch-bot\/ai\/(.+)$/,
				replacement: fileURLToPath(new URL("./packages/ai/src/$1.ts", import.meta.url)),
			},
			{ find: /^@punch-bot\/agent$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@punch-bot\/agent\/node$/, replacement: workspaceSourcePaths.agentNode },
			{ find: /^@punch-bot\/protocol$/, replacement: workspaceSourcePaths.protocolIndex },
			{ find: /^@punch-bot\/client$/, replacement: workspaceSourcePaths.clientIndex },
			{ find: /^@punch-bot\/client\/unix$/, replacement: workspaceSourcePaths.clientUnix },
			{ find: /^@punch-bot\/server$/, replacement: workspaceSourcePaths.serverIndex },
			{ find: /^@punch-bot\/server\/unix$/, replacement: workspaceSourcePaths.serverUnix },
		],
	},
};
