import { release } from "node:os";
import { describe, expect, it } from "vitest";
import { getBrianUserAgent } from "../src/utils/brian-user-agent.ts";

describe("getBrianUserAgent", () => {
	it("does not expose the host kernel version or CPU architecture", () => {
		const userAgent = getBrianUserAgent();

		expect(userAgent).toBe("brian-agent");
		expect(userAgent).not.toContain(release());
	});
});
