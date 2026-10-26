import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_NAME, ENV_AGENT_DIR, getAgentDir } from "../config.ts";

export const SERVICE_LABEL = `dev.${APP_NAME}.agent`;

export type ServiceKind = "launchd" | "systemd";

/** How to install, start, and stop the background service on one OS. */
export interface ServicePlan {
	kind: ServiceKind;
	file: string;
	content: string;
	logFile: string;
	start: string[][];
	stop: string[][];
	isRunning: string[];
}

export interface ServiceOptions {
	platform?: NodeJS.Platform;
	home?: string;
	uid?: number;
	command?: string[];
	logFile?: string;
	env?: Record<string, string>;
}

/** The command line that runs `brian serve` with this same runtime and entry point. */
export function serveCommand(): string[] {
	const entry = process.argv[1];
	return [process.execPath, ...process.execArgv, ...(entry ? [entry] : []), "serve"];
}

function serviceEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of ["PATH", "HOME", ENV_AGENT_DIR]) {
		const value = process.env[key];
		if (value) env[key] = value;
	}
	return env;
}

const xml = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const systemdQuote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

export function buildServicePlan(options: ServiceOptions = {}): ServicePlan | undefined {
	const platform = options.platform ?? process.platform;
	const home = options.home ?? homedir();
	const command = options.command ?? serveCommand();
	const logFile = options.logFile ?? join(getAgentDir(), "logs", "serve.log");
	const env = options.env ?? serviceEnv();
	if (platform === "darwin") {
		const uid = options.uid ?? process.getuid?.() ?? 501;
		const file = join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
		const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${SERVICE_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
${command.map((arg) => `		<string>${xml(arg)}</string>`).join("\n")}
	</array>
	<key>EnvironmentVariables</key>
	<dict>
${Object.entries(env)
	.map(([k, v]) => `		<key>${xml(k)}</key><string>${xml(v)}</string>`)
	.join("\n")}
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>${xml(logFile)}</string>
	<key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`;
		const target = `gui/${uid}`;
		return {
			kind: "launchd",
			file,
			content,
			logFile,
			start: [
				["launchctl", "bootout", `${target}/${SERVICE_LABEL}`],
				["launchctl", "bootstrap", target, file],
			],
			stop: [["launchctl", "bootout", `${target}/${SERVICE_LABEL}`]],
			isRunning: ["launchctl", "print", `${target}/${SERVICE_LABEL}`],
		};
	}
	if (platform === "linux") {
		const unit = `${APP_NAME}.service`;
		const file = join(home, ".config", "systemd", "user", unit);
		const content = `[Unit]
Description=Brian, your agent
After=network-online.target

[Service]
ExecStart=${command.map(systemdQuote).join(" ")}
${Object.entries(env)
	.map(([k, v]) => `Environment=${systemdQuote(`${k}=${v}`)}`)
	.join("\n")}
Restart=on-failure
RestartSec=5
StandardOutput=append:${logFile}
StandardError=append:${logFile}

[Install]
WantedBy=default.target
`;
		return {
			kind: "systemd",
			file,
			content,
			logFile,
			start: [
				["systemctl", "--user", "daemon-reload"],
				["systemctl", "--user", "enable", unit],
				["systemctl", "--user", "restart", unit],
			],
			stop: [["systemctl", "--user", "disable", "--now", unit]],
			isRunning: ["systemctl", "--user", "is-active", "--quiet", unit],
		};
	}
	return undefined;
}

export type CommandRunner = (command: string[]) => { code: number; output: string };

export const runCommand: CommandRunner = ([cmd, ...args]) => {
	const env = { ...process.env };
	// systemctl --user needs the user bus; ssh and sudo -u sessions often drop XDG_RUNTIME_DIR.
	const uid = process.getuid?.();
	if (!env.XDG_RUNTIME_DIR && uid !== undefined && existsSync(`/run/user/${uid}`))
		env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
	const result = spawnSync(cmd, args, { encoding: "utf8", env });
	return {
		code: result.status ?? 1,
		output: `${result.stdout ?? ""}${result.stderr ?? result.error?.message ?? ""}`.trim(),
	};
};

/** Write the service file and (re)start it. The first launchd bootout fails when nothing is loaded; that's expected. */
export function installService(plan: ServicePlan, run: CommandRunner = runCommand): void {
	mkdirSync(dirname(plan.file), { recursive: true });
	mkdirSync(dirname(plan.logFile), { recursive: true });
	writeFileSync(plan.file, plan.content);
	plan.start.forEach((command, i) => {
		const result = run(command);
		const optional = plan.kind === "launchd" && i === 0;
		if (result.code !== 0 && !optional) throw new Error(`${command.join(" ")} failed: ${result.output}`);
	});
}

/** Stop the service and remove its file so it doesn't come back at login. */
export function removeService(plan: ServicePlan, run: CommandRunner = runCommand): boolean {
	if (!existsSync(plan.file)) return false;
	for (const command of plan.stop) run(command);
	rmSync(plan.file, { force: true });
	if (plan.kind === "systemd") run(["systemctl", "--user", "daemon-reload"]);
	return true;
}

export function serviceState(
	plan: ServicePlan,
	run: CommandRunner = runCommand,
): "running" | "stopped" | "not installed" {
	if (!existsSync(plan.file)) return "not installed";
	return run(plan.isRunning).code === 0 ? "running" : "stopped";
}
