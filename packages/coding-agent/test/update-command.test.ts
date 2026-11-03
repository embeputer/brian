import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME, PACKAGE_NAME, VERSION } from "../src/config.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";
import { allowNetwork } from "./test-network-env.ts";

const spawned = vi.hoisted(() => [] as { command: string; args: string[] }[]);

vi.mock("../src/utils/child-process.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/utils/child-process.ts")>();
	return {
		...actual,
		spawnProcess(command: string, args: string[]) {
			spawned.push({ command, args });
			const child = new EventEmitter();
			queueMicrotask(() => {
				child.emit("close", 0, null);
			});
			return child;
		},
	};
});

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPackageDir = process.env.BRIAN_PACKAGE_DIR;
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;

function setExecPath(value: string): void {
	Object.defineProperty(process, "execPath", { configurable: true, value });
}

function plain(value: unknown): string {
	return String(value).replace(/\u001b\[[0-9;]*m/g, "");
}

function loggedLines(log: { mock: { calls: unknown[][] } }): string[] {
	return log.mock.calls.map((call) => call.map((part) => plain(part)).join(" "));
}

/** Global npm prefix layout that `getSelfUpdateCommand` accepts as writable. */
function createNpmPrefixInstall(): void {
	const prefix = mkdtempSync(join(tmpdir(), "brian-update-"));
	const packageDir = join(prefix, "lib", "node_modules", "@brian-agent", "cli");
	mkdirSync(packageDir, { recursive: true });
	tempDir = prefix;
	process.env.BRIAN_PACKAGE_DIR = packageDir;
	setExecPath(join(packageDir, "dist", "cli.js"));
}

function publishedVersion(version: string): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ name: PACKAGE_NAME, version })),
	);
}

beforeEach(() => {
	allowNetwork();
	spawned.length = 0;
	process.exitCode = undefined;
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	if (execPathDescriptor) {
		Object.defineProperty(process, "execPath", execPathDescriptor);
	}
	if (originalPackageDir === undefined) {
		delete process.env.BRIAN_PACKAGE_DIR;
	} else {
		process.env.BRIAN_PACKAGE_DIR = originalPackageDir;
	}
	if (originalArgv1 === undefined) {
		process.argv.splice(1, 1);
	} else {
		process.argv[1] = originalArgv1;
	}
	if (tempDir) {
		chmodSync(tempDir, 0o700);
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
	process.exitCode = undefined;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("brian update", () => {
	it("prints the current and published versions and does not install when they match", async () => {
		publishedVersion(VERSION);
		const log = vi.mocked(console.log);

		expect(await handlePackageCommand(["update"])).toBe(true);

		const lines = loggedLines(log);
		const current = lines.indexOf(`Current version: ${VERSION}`);
		const available = lines.indexOf(`Available version: ${VERSION}`);
		expect(current).toBeGreaterThanOrEqual(0);
		expect(available).toBeGreaterThan(current);
		expect(lines.some((line) => line.includes(`${APP_NAME} is already up to date`))).toBe(true);
		expect(lines.some((line) => line.includes("Updating"))).toBe(false);
		expect(spawned).toEqual([]);
		expect(process.exitCode ?? 0).toBe(0);
	});

	it("installs the published package when it is newer", async () => {
		createNpmPrefixInstall();
		publishedVersion("99.0.0");
		const log = vi.mocked(console.log);
		const error = vi.mocked(console.error);

		expect(await handlePackageCommand(["update"])).toBe(true);

		const lines = loggedLines(log);
		expect(lines.indexOf("Available version: 99.0.0")).toBeGreaterThan(lines.indexOf(`Current version: ${VERSION}`));
		expect(lines.some((line) => line.includes(`Updated ${APP_NAME} from ${VERSION} to 99.0.0`))).toBe(true);
		expect(spawned).toHaveLength(1);
		expect(spawned[0]?.command).toBe("npm");
		expect(spawned[0]?.args).toEqual(
			expect.arrayContaining(["install", "-g", "--ignore-scripts", "--min-release-age=0", `${PACKAGE_NAME}@99.0.0`]),
		);
		expect(plain(error.mock.calls)).not.toContain("cannot self-update");
		expect(process.exitCode ?? 0).toBe(0);
	});

	it("reinstalls the current published version when --force is set", async () => {
		createNpmPrefixInstall();
		publishedVersion(VERSION);

		expect(await handlePackageCommand(["update", "--force"])).toBe(true);

		expect(spawned).toHaveLength(1);
		expect(spawned[0]?.args).toContain(`${PACKAGE_NAME}@${VERSION}`);
		expect(process.exitCode ?? 0).toBe(0);
	});
});
