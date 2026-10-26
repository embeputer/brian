/**
 * Status Line Extension
 *
 * Demonstrates ctx.ui.setStatus() for displaying persistent status text in the footer.
 * Shows turn progress with themed colors.
 */

import { type ExtensionAPI, theme } from "@brian-agent/cli";

export default function (brian: ExtensionAPI) {
	let turnCount = 0;

	brian.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("status-demo", theme.fg("dim", "Ready"));
	});

	brian.on("turn_start", async (_event, ctx) => {
		turnCount++;
		const spinner = theme.fg("accent", "●");
		const text = theme.fg("dim", ` Turn ${turnCount}...`);
		ctx.ui.setStatus("status-demo", spinner + text);
	});

	brian.on("turn_end", async (_event, ctx) => {
		const check = theme.fg("success", "✓");
		const text = theme.fg("dim", ` Turn ${turnCount} complete`);
		ctx.ui.setStatus("status-demo", check + text);
	});
}
