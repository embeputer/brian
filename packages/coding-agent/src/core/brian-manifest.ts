import { readFileSync } from "node:fs";
import { stripBom } from "../utils/text.ts";

export interface BrianManifest {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
}

const RESOURCE_FIELDS = ["extensions", "skills", "prompts"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readBrianManifest(packageJsonPath: string): BrianManifest | null {
	try {
		const pkg: unknown = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8")));
		if (!isObject(pkg) || !isObject(pkg.brian)) {
			return null;
		}

		const manifest: BrianManifest = {};
		for (const field of RESOURCE_FIELDS) {
			const entries = pkg.brian[field];
			if (Array.isArray(entries) && entries.every((entry) => typeof entry === "string")) {
				manifest[field] = entries;
			}
		}
		return manifest;
	} catch {
		return null;
	}
}
