# @brian-agent/a2a

Agent2Agent (A2A) protocol integration for brian agents.

This package wraps the official [`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk) and provides brian-specific helpers for:

- exposing a brian agent as an A2A server
- delegating tasks to external A2A agents (for example Hermes)
- bridging `AgentHarness` prompt execution to A2A task lifecycle events
- discovering other brian A2A servers on the same machine

## Server

```ts
import { createA2aServer } from "@brian-agent/a2a";

const server = await createA2aServer({
  baseUrl: "http://localhost:41241",
  runnerFactory: (contextId) => ({
    async prompt(text) {
      return { text: `echo: ${text}` };
    },
  }),
});

await server.listen(41241);
```

`listen()` can take port `0` to bind an ephemeral port. The returned address includes the bound `host`, `port`, and card `url`.

JSON-RPC calls need `Authorization: Bearer <server.token>`; without it the server replies 401. Pass `token` to choose the value, otherwise a random one is generated. The agent card at `/.well-known/agent-card.json` stays open. Requests whose `Host` header is not the bound address, a loopback name at the bound port (for loopback binds), the card URL host, or an entry in `allowedHosts` get 403.

## Same-machine discovery

Brian sandboxes on one machine advertise a JSON lease into a shared directory (`BRIAN_A2A_DISCOVERY_DIR`, else `$XDG_RUNTIME_DIR/brian/a2a`, else a per-user temp dir). Peers that can see that directory can list live advertisements, including each server's `token`, and connect over A2A without a preconfigured URL. The directory must be owned by the current user; it is set to mode `0700` and lease files are `0600`.

```ts
import { LocalA2aDiscovery, defaultA2aDiscoveryDir } from "@brian-agent/a2a";

const discovery = new LocalA2aDiscovery({ dir: defaultA2aDiscoveryDir() });
discovery.advertise({
  id: "alice",
  name: "alice",
  url: "http://127.0.0.1:41241/",
  token: server.token,
  pid: process.pid,
  startedAt: Date.now(),
});

const bob = discovery.find("bob");
```

Stale leases (past TTL without a heartbeat) are dropped on list. Docker sandboxes that do not share loopback should set `BRIAN_A2A_DISCOVERY_DIR` to a shared volume and advertise a reachable URL.

## Client

```ts
import { delegateToA2aAgent } from "@brian-agent/a2a";

const result = await delegateToA2aAgent({
  url: "http://localhost:41241",
  task: "Summarize the repository structure",
  token: server.token, // or the peer record's token
});

console.log(result.text);
```
