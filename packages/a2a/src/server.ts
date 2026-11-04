import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { createBrianAgentCard } from "./agent-card.ts";
import { HarnessAgentExecutor, type HarnessPromptRunnerFactory } from "./executor.ts";
import { formatA2aHttpUrl } from "./http-url.ts";

export interface A2aListenAddress {
	host: string;
	port: number;
	url: string;
}

export interface CreateA2aServerOptions {
	baseUrl?: string;
	publicHost?: string;
	runnerFactory: HarnessPromptRunnerFactory;
	name?: string;
	description?: string;
	/** Bearer token required on JSON-RPC calls. A random token is generated when omitted. */
	token?: string;
	/** Extra `Host` header values to accept, e.g. `proxy.local:8080`. */
	allowedHosts?: string[];
}

export interface A2aServer {
	app: Express;
	/** Bearer token clients must send as `Authorization: Bearer <token>`. */
	readonly token: string;
	requestHandler: DefaultRequestHandler | undefined;
	listen(port?: number, host?: string): Promise<A2aListenAddress>;
	close(): Promise<void>;
	address(): A2aListenAddress | undefined;
	unref(): void;
}

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

function isLoopbackOrWildcard(address: string): boolean {
	return (
		address === "0.0.0.0" ||
		address === "::" ||
		address === "::1" ||
		address === "localhost" ||
		address.startsWith("127.") ||
		address.startsWith("::ffff:127.")
	);
}

function formatHostHeader(address: string, port: number): string {
	const hostname = address.includes(":") ? `[${address}]` : address;
	return `${hostname}:${port}`.toLowerCase();
}

function bearerMatches(header: string | undefined, token: string): boolean {
	const value = header ?? "";
	const given = Buffer.from(value.startsWith("Bearer ") ? value.slice(7) : "");
	const expected = Buffer.from(token);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function createA2aServer(options: CreateA2aServerOptions): Promise<A2aServer> {
	const token = options.token ?? randomBytes(24).toString("base64url");
	if (!token) throw new Error("A2A server token must not be empty");
	const allowedHosts = new Set((options.allowedHosts ?? []).map((host) => host.toLowerCase()));
	const taskStore = new InMemoryTaskStore();
	const agentExecutor = new HarnessAgentExecutor(options.runnerFactory);
	const app = express();
	let requestHandler: DefaultRequestHandler | undefined;
	let routesMounted = false;
	let server: ReturnType<Express["listen"]> | undefined;
	let bound: A2aListenAddress | undefined;

	// Reject requests whose Host is not this server, so a DNS-rebound browser page cannot reach it.
	app.use((req: Request, res: Response, next: NextFunction) => {
		const host = req.headers.host?.toLowerCase();
		if (!host || !allowedHosts.has(host)) {
			res.status(403).json({ error: "forbidden host" });
			return;
		}
		next();
	});
	app.use((req: Request, res: Response, next: NextFunction) => {
		if (req.method === "GET" && req.path === `/${AGENT_CARD_PATH}`) {
			next();
			return;
		}
		if (!bearerMatches(req.headers.authorization, token)) {
			res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "unauthorized" });
			return;
		}
		next();
	});

	function mount(baseUrl: string): void {
		if (routesMounted) return;
		allowedHosts.add(new URL(baseUrl).host.toLowerCase());
		const agentCard = createBrianAgentCard({
			baseUrl,
			name: options.name,
			description: options.description,
		});
		requestHandler = new DefaultRequestHandler(agentCard, taskStore, agentExecutor);
		app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
		app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));
		routesMounted = true;
	}

	if (options.baseUrl) mount(options.baseUrl);

	return {
		app,
		token,
		get requestHandler() {
			return requestHandler;
		},
		listen(port = 0, host = "127.0.0.1") {
			return new Promise((resolve, reject) => {
				server = app.listen(port, host, (error?: Error) => {
					if (error) {
						reject(error);
						return;
					}
					const addr = server?.address();
					if (!addr || typeof addr === "string") {
						reject(new Error("A2A server bound without a TCP address"));
						return;
					}
					const info = addr as AddressInfo;
					const url = options.baseUrl ?? formatA2aHttpUrl(options.publicHost ?? info.address, info.port);
					bound = { host: info.address, port: info.port, url };
					allowedHosts.add(formatHostHeader(info.address, info.port));
					if (isLoopbackOrWildcard(info.address)) {
						for (const name of LOOPBACK_HOSTNAMES) allowedHosts.add(`${name}:${info.port}`);
					}
					try {
						mount(url);
					} catch (err) {
						reject(err);
						return;
					}
					resolve(bound);
				});
			});
		},
		address() {
			return bound;
		},
		unref() {
			server?.unref();
		},
		close() {
			return new Promise((resolve, reject) => {
				if (!server) {
					bound = undefined;
					resolve();
					return;
				}
				server.close((error) => {
					if (error) reject(error);
					else {
						bound = undefined;
						resolve();
					}
				});
			});
		},
	};
}
