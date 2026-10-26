/**
 * Displays a status widget showing the system prompt length.
 *
 * Demonstrates ctx.getSystemPrompt() for accessing the effective system prompt.
 */
import type { ExtensionAPI } from "@brian-agent/cli";

export default function (brian: ExtensionAPI) {
	brian.on("agent_start", (_event, ctx) => {
		const prompt = ctx.getSystemPrompt();
		ctx.ui.setStatus("system-prompt", `System: ${prompt.length} chars`);
	});

	brian.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("system-prompt", undefined);
	});
}
