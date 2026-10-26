import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const workspaceSourcePaths = {
	telemetryIndex: fileURLToPath(new URL("./packages/telemetry/src/index.ts", import.meta.url)),
	telemetryTesting: fileURLToPath(new URL("./packages/telemetry/src/testing/index.ts", import.meta.url)),
	mcpIndex: fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
	mcpOAuth: fileURLToPath(new URL("./packages/mcp/src/oauth/index.ts", import.meta.url)),
	mcpTesting: fileURLToPath(new URL("./packages/mcp/src/testing/index.ts", import.meta.url)),
	aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
	aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
	aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
	aiApi: fileURLToPath(new URL("./packages/ai/src/api", import.meta.url)),
	aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
	aiUtils: fileURLToPath(new URL("./packages/ai/src/utils", import.meta.url)),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	codemodeIndex: fileURLToPath(new URL("./packages/codemode/src/index.ts", import.meta.url)),
	codemodeDeclarations: fileURLToPath(new URL("./packages/codemode/src/declarations.ts", import.meta.url)),
	codemodeSource: fileURLToPath(new URL("./packages/codemode/src/source.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
	a2aIndex: fileURLToPath(new URL("./packages/a2a/src/index.ts", import.meta.url)),
} as const;

export default defineConfig({
	resolve: {
		conditions: ["source"],
		alias: [
			{ find: /^@brian-agent\/cli$/, replacement: workspaceSourcePaths.codingAgentIndex },
			{ find: /^@brian-agent\/a2a$/, replacement: workspaceSourcePaths.a2aIndex },
			{ find: /^@brian-agent\/telemetry$/, replacement: workspaceSourcePaths.telemetryIndex },
			{ find: /^@brian-agent\/telemetry\/testing$/, replacement: workspaceSourcePaths.telemetryTesting },
			{ find: /^@brian-agent\/mcp$/, replacement: workspaceSourcePaths.mcpIndex },
			{ find: /^@brian-agent\/mcp\/oauth$/, replacement: workspaceSourcePaths.mcpOAuth },
			{ find: /^@brian-agent\/mcp\/testing$/, replacement: workspaceSourcePaths.mcpTesting },
			{ find: /^@brian-agent\/ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@brian-agent\/ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@brian-agent\/ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@brian-agent\/ai\/utils\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiUtils}/$1.ts`,
			},
			{
				find: /^@brian-agent\/ai\/api\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiApi}/$1.ts`,
			},
			{
				find: /^@brian-agent\/ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{
				find: /^@brian-agent\/ai\/(.+)$/,
				replacement: fileURLToPath(new URL("./packages/ai/src/$1.ts", import.meta.url)),
			},
			{ find: /^@brian-agent\/agent$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@brian-agent\/codemode$/, replacement: workspaceSourcePaths.codemodeIndex },
			{ find: /^@brian-agent\/codemode\/declarations$/, replacement: workspaceSourcePaths.codemodeDeclarations },
			{ find: /^@brian-agent\/codemode\/source$/, replacement: workspaceSourcePaths.codemodeSource },
		],
	},
	ssr: { resolve: { conditions: ["source"] } },
});
