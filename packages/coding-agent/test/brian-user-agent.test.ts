import { describe, expect, it } from "vitest";
import { getBrianUserAgent } from "../src/utils/brian-user-agent.ts";

describe("getBrianUserAgent", () => {
	it("formats the user agent expected by pi.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getBrianUserAgent("1.2.3");

		expect(userAgent).toBe(`brian/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^brian\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
