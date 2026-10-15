import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportFromFile } from "../src/core/export-html/index.ts";
import { CURRENT_SESSION_VERSION, type SessionHeader, type SessionMessageEntry } from "../src/core/session-manager.ts";

interface HtmlViewer {
	formatReadLineRange(offset: unknown, limit: unknown): string;
	getTreeNodeDisplayHtml(entry: SessionMessageEntry): string;
	renderEntry(entry: SessionMessageEntry): string;
}

// Runs the exported viewer's real data loading and renderers, stopping before DOM initialization.
function loadHtmlViewer(html: string): HtmlViewer {
	const sessionData = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
	if (!sessionData || !script) throw new Error("Missing exported session data or viewer script");
	return runInNewContext(
		script.replace(
			"marked.use({",
			"return { formatReadLineRange, getTreeNodeDisplayHtml, renderEntry }; marked.use({",
		),
		{
			atob,
			TextDecoder,
			URLSearchParams,
			document: { getElementById: () => ({ textContent: sessionData }), querySelector: () => null },
			window: { location: { search: "" } },
		},
	);
}

// #9887
describe("read line range display", () => {
	let tempDir: string;
	const cases: [unknown, unknown, string][] = [
		[25, 13, ":25-37"],
		["25", "13", ":25-37"],
		[null, "13", ":1-13"],
		["25", null, ":25"],
		[undefined, undefined, ""],
		["abc", 13, ""],
		[25, "", ""],
		[25, "Infinity", ""],
	];

	beforeAll(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-read-range-"));
	});

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("shows string ranges in the HTML export", async () => {
		const args = { path: "notes.txt", offset: "25", limit: "13" };
		const assistant: SessionMessageEntry = {
			type: "message",
			id: "assistant",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "call", name: "read", arguments: args }],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: 0,
			},
		};
		const result: SessionMessageEntry = {
			type: "message",
			id: "result",
			parentId: assistant.id,
			timestamp: assistant.timestamp,
			message: {
				role: "toolResult",
				toolCallId: "call",
				toolName: "read",
				content: [],
				isError: false,
				timestamp: 0,
			},
		};
		const header = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: "range-test",
			timestamp: assistant.timestamp,
			cwd: tempDir,
		} satisfies SessionHeader;
		const sessionPath = join(tempDir, "session.jsonl");
		writeFileSync(sessionPath, `${[header, assistant, result].map((entry) => JSON.stringify(entry)).join("\n")}\n`);

		const viewer = loadHtmlViewer(readFileSync(await exportFromFile(sessionPath, join(tempDir, "out.html")), "utf8"));
		for (const [offset, limit, range] of cases) {
			expect(viewer.formatReadLineRange(offset, limit), `${offset}, ${limit}`).toBe(range);
		}
		expect(viewer.getTreeNodeDisplayHtml(result)).toBe('<span class="tree-role-tool">[read: notes.txt:25-37]</span>');
		expect(viewer.renderEntry(assistant)).toContain('<span class="line-numbers">:25-37</span>');
	});
});
