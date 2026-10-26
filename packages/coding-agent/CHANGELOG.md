# Changelog

## [Unreleased]

### Added

- Brian picks up new models without a release: it downloads a model catalog rebuilt every 6 hours from models.dev and provider model lists ([#17](https://github.com/embeputer/brian/pull/17))
- `brian serve` survives restarts mid-work: routine tasks resume from their saved session, chats are not answered twice, and a send cut off by a restart becomes a draft instead of being resent ([#18](https://github.com/embeputer/brian/pull/18))
- The `messages` tool refuses to send the exact same text to the same chat twice within an hour ([#18](https://github.com/embeputer/brian/pull/18))

### Changed

- Provider attribution headers (OpenRouter, NVIDIA, Cloudflare) are controlled by the new `providerAttribution` setting, replacing `enableInstallTelemetry` ([#20](https://github.com/embeputer/brian/pull/20))
- MCP `clientRegistration: "cimd"` uses Brian's own client metadata document and requires authorization servers that send `iss` (RFC 9207) ([#20](https://github.com/embeputer/brian/pull/20))

### Removed

- The install ping, the `BRIAN_TELEMETRY` variable, the Radius provider, and the pi managed-installer update path ([#20](https://github.com/embeputer/brian/pull/20))
- The unused `@brian-agent/durable`, `@brian-agent/env` and `@brian-agent/chord` packages ([#20](https://github.com/embeputer/brian/pull/20))

## [0.1.0] - 2026-10-26

Initial Brian release, forked from pi 1.3.0. For earlier history, see [pi's changelog](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/CHANGELOG.md).

### Added

- `brian` CLI: `onboard`/`hatch` (profile + model connection), `setup`, `connect`, `model`, `status`, `doctor`, `skill`, `uninstall`.
- Markdown memory vault (`People/`, `Agent/`, user folders) with `brian memory search|add|show|list` and built-in memory tools.
- Local routines, the `brians` inter-Brian tool, todos, and the plan gate.
- Weekly skill and memory audit (`brian audit`).
- Beeper messaging gateway with per-chat policies, drafts and approvals, a first-contact intro, and "sent by brian" marking.
- `brian serve`, `brian wake`/`sleep` background service (launchd/systemd), and a token-protected local API.

### Removed

- Terminal UI, interactive mode, `/share`, and the Punch bot server.
