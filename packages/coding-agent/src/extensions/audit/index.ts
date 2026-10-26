import { join } from "node:path";
import { getAgentDir, getMemoryDir } from "../../config.ts";
import { classifyUse, UsageStore } from "../../core/audit.ts";
import type { ExtensionAPI } from "../../core/extensions/types.ts";

export function getUsageStore(): UsageStore {
	return new UsageStore(join(getAgentDir(), "usage.json"));
}

/** Records which skills and memory notes Brian reads or writes, for the weekly audit. */
export default function auditExtension(brian: ExtensionAPI): void {
	const store = getUsageStore();
	const skillsDir = join(getAgentDir(), "skills");
	const memoryDir = getMemoryDir();
	const track = (file: string, cwd: string) => {
		const use = classifyUse(file, cwd, skillsDir, memoryDir);
		if (!use) return;
		try {
			store.record(use.kind, use.key);
		} catch {
			// usage tracking is best effort
		}
	};
	brian.on("tool_result", (event, ctx) => {
		if (event.isError) return;
		if (event.toolName === "read" && typeof event.input.path === "string") track(event.input.path, ctx.cwd);
		if (event.toolName === "memory_search" || event.toolName === "memory_write") {
			const details = event.details as { results?: Array<{ path?: string }>; path?: string } | undefined;
			for (const result of details?.results ?? []) if (result.path) track(result.path, ctx.cwd);
			if (details?.path) track(details.path, ctx.cwd);
		}
	});
}
