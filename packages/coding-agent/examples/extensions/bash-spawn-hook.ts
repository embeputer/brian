/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   brian -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@brian-agent/cli";
import { createBashTool } from "@brian-agent/cli";

export default function (brian: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, BRIAN_SPAWN_HOOK: "1" },
		}),
	});

	brian.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
