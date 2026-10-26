import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalBrianExperimental = process.env.BRIAN_EXPERIMENTAL;

	afterEach(() => {
		if (originalBrianExperimental === undefined) {
			delete process.env.BRIAN_EXPERIMENTAL;
		} else {
			process.env.BRIAN_EXPERIMENTAL = originalBrianExperimental;
		}
	});

	it("returns false when BRIAN_EXPERIMENTAL is unset", () => {
		delete process.env.BRIAN_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when BRIAN_EXPERIMENTAL is empty", () => {
		process.env.BRIAN_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when BRIAN_EXPERIMENTAL is set to 1", () => {
		process.env.BRIAN_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when BRIAN_EXPERIMENTAL is set to 0", () => {
		process.env.BRIAN_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when BRIAN_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.BRIAN_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
