import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runServe, runSleep, runWake } from "../src/cli/serve-command.ts";
import { MessagingStore } from "../src/core/messaging/gateway.ts";
import { loadServeConfig, startLoops, startServer } from "../src/core/serve.ts";
import {
	buildServicePlan,
	type CommandRunner,
	installService,
	removeService,
	serviceState,
} from "../src/core/service.ts";
import type { RoutineExecutor } from "../src/extensions/brian/routine-runner.ts";
import { RoutineStore } from "../src/extensions/brian/routines.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "brian-serve-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

const command = ["/usr/bin/node", "/opt/brian/cli.js", "serve"];

function fakeRunner(codes: Record<string, number> = {}) {
	const calls: string[] = [];
	const run: CommandRunner = (cmd) => {
		const line = cmd.join(" ");
		calls.push(line);
		return { code: codes[line] ?? 0, output: "" };
	};
	return { run, calls };
}

describe("service plan", () => {
	it("writes a launchd agent that keeps brian serve alive", () => {
		const plan = buildServicePlan({
			platform: "darwin",
			home: root,
			uid: 501,
			command,
			logFile: "/l/serve.log",
			env: { PATH: "/usr/bin" },
		});
		expect(plan?.file).toBe(join(root, "Library/LaunchAgents/dev.brian.agent.plist"));
		expect(plan?.content).toContain("<string>/opt/brian/cli.js</string>");
		expect(plan?.content).toContain("<key>KeepAlive</key><true/>");
		expect(plan?.start.at(-1)).toEqual(["launchctl", "bootstrap", "gui/501", plan?.file]);
	});

	it("writes a systemd user unit and quotes arguments", () => {
		const plan = buildServicePlan({
			platform: "linux",
			home: root,
			command: [...command, "--host", "my host"],
			logFile: "/l/serve.log",
			env: { PATH: "/usr/bin" },
		});
		expect(plan?.content).toContain('ExecStart="/usr/bin/node" "/opt/brian/cli.js" "serve" "--host" "my host"');
		expect(plan?.content).toContain('Environment="PATH=/usr/bin"');
		expect(plan?.content).toContain("WantedBy=default.target");
		expect(plan?.stop).toEqual([["systemctl", "--user", "disable", "--now", "brian.service"]]);
	});

	it("is unsupported on other platforms", () => {
		expect(buildServicePlan({ platform: "win32", home: root, command })).toBeUndefined();
	});

	it("installs, reports, and removes the service", () => {
		const plan = buildServicePlan({
			platform: "darwin",
			home: root,
			uid: 501,
			command,
			logFile: join(root, "logs/serve.log"),
			env: {},
		});
		if (!plan) throw new Error("no plan");
		const { run, calls } = fakeRunner({ "launchctl bootout gui/501/dev.brian.agent": 3 });
		expect(serviceState(plan, run)).toBe("not installed");
		installService(plan, run);
		expect(readFileSync(plan.file, "utf8")).toBe(plan.content);
		expect(serviceState(plan, run)).toBe("running");
		expect(removeService(plan, run)).toBe(true);
		expect(existsSync(plan.file)).toBe(false);
		expect(removeService(plan, run)).toBe(false);
		expect(calls).toContain(`launchctl bootstrap gui/501 ${plan.file}`);
	});

	it("fails install when the service manager refuses", () => {
		const plan = buildServicePlan({
			platform: "linux",
			home: root,
			command,
			logFile: join(root, "serve.log"),
			env: {},
		});
		if (!plan) throw new Error("no plan");
		const { run } = fakeRunner({ "systemctl --user daemon-reload": 1 });
		expect(() => installService(plan, run)).toThrow(/daemon-reload failed/);
	});
});

describe("serve config", () => {
	it("creates a token once and keeps it private", () => {
		const file = join(root, "serve.json");
		const first = loadServeConfig(file);
		expect(first.token.length).toBeGreaterThan(20);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(loadServeConfig(file).token).toBe(first.token);
	});
});

describe("local API", () => {
	it("leaves health open and requires the token for everything else", async () => {
		const prompt = vi.fn(async (text: string) => `echo: ${text}`);
		const { server, url } = await startServer(
			{ host: "127.0.0.1", port: 0, token: "secret-token" },
			{ status: () => ({ ok: 1 }), prompt },
		);
		try {
			expect(await (await fetch(`${url}/v1/health`)).json()).toMatchObject({ ok: true, name: "brian" });
			expect((await fetch(`${url}/v1/status`)).status).toBe(401);
			expect((await fetch(`${url}/v1/status`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
			const auth = { authorization: "Bearer secret-token" };
			expect(await (await fetch(`${url}/v1/status`, { headers: auth })).json()).toEqual({ ok: 1 });
			const res = await fetch(`${url}/v1/prompt`, {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ prompt: "hi" }),
			});
			expect(await res.json()).toEqual({ text: "echo: hi" });
			expect((await fetch(`${url}/v1/prompt`, { method: "POST", headers: auth, body: "{}" })).status).toBe(400);
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});
});

describe("loops", () => {
	it("runs immediately, repeats, and reports errors without stopping", async () => {
		vi.useFakeTimers();
		const errors: string[] = [];
		let n = 0;
		const stop = startLoops(
			[
				{
					name: "x",
					intervalMs: 1000,
					async tick() {
						n++;
						if (n === 2) throw new Error("boom");
					},
				},
			],
			(name, e) => errors.push(`${name}: ${(e as Error).message}`),
		);
		await vi.advanceTimersByTimeAsync(2500);
		stop();
		await vi.advanceTimersByTimeAsync(5000);
		vi.useRealTimers();
		expect(n).toBe(3);
		expect(errors).toEqual(["x: boom"]);
	});
});

describe("brian serve", () => {
	it("serves prompts through the executor and stops on abort", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const executor: RoutineExecutor = { runTask: async (p) => `done: ${p}`, notify: async () => {} };
		const controller = new AbortController();
		const config = { host: "127.0.0.1", port: 0, token: "t" };
		const done = runServe(["--no-gateway"], {
			executor,
			config,
			routines: new RoutineStore(join(root, "routines.db")),
			messaging: new MessagingStore(join(root, "messaging.json")),
			beeperConfigFile: join(root, "none.json"),
			signal: controller.signal,
		});
		await vi.waitFor(() => expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/listening on/)));
		const url = String(vi.mocked(console.log).mock.calls[0][0]).match(/http:\/\/\S+/)?.[0];
		const res = await fetch(`${url}/v1/prompt`, {
			method: "POST",
			headers: { authorization: "Bearer t" },
			body: JSON.stringify({ prompt: "plan" }),
		});
		expect(await res.json()).toEqual({ text: "done: plan" });
		const status = await (await fetch(`${url}/v1/status`, { headers: { authorization: "Bearer t" } })).json();
		expect(status).toMatchObject({ beeperConnected: false, pendingDrafts: 0, routines: 0 });
		controller.abort();
		expect(await done).toBe(0);
	});
});

describe("brian wake / sleep", () => {
	it("installs the service and waits until it answers", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const plan = buildServicePlan({
			platform: "linux",
			home: root,
			command,
			logFile: join(root, "serve.log"),
			env: {},
		});
		if (!plan) throw new Error("no plan");
		const { run } = fakeRunner();
		const fakeFetch = vi.fn(async () => new Response("{}", { status: 200 }));
		const deps = {
			plan,
			run,
			config: { host: "127.0.0.1", port: 7333, token: "t" },
			fetch: fakeFetch as unknown as typeof fetch,
			waitMs: 0,
		};
		expect(await runWake([], deps)).toBe(0);
		expect(fakeFetch).toHaveBeenCalledWith("http://127.0.0.1:7333/v1/health");
		expect(log.mock.calls.flat().join("\n")).toMatch(/brian is awake/);
		expect(runSleep([], deps)).toBe(0);
		expect(existsSync(plan.file)).toBe(false);
		expect(log).toHaveBeenLastCalledWith("brian is asleep.");
	});
});
