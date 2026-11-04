# Changelog

## [Unreleased]

### Fixed

- Credential reads now notice when another process rewrites `auth.json` with content of the same length right after Brian loaded it. Previously the change could be missed and the old credential returned until the file changed again ([#40](https://github.com/embeputer/brian/pull/40))

## [0.2.3] - 2026-11-04

### Fixed

- When `brian messages watch` and the `brian serve` gateway decide on messages from other people, `memory_write` can now only create or append to notes directly in `People/`. It refuses `Agent/` and every other folder, `People/` subfolders, `mode: "replace"`, the `me` tag, and content that starts with frontmatter. Before, a message could get Brian to write an `Agent/` note, which is loaded into the system prompt of later runs with all tools (your brian chat, routines). The restriction is the new `--memory-people-only` flag ([#39](https://github.com/embeputer/brian/pull/39))

## [0.2.2] - 2026-11-04

### Fixed

- Updated `minimatch` to 11.0.4 to fix a denial of service from crafted glob patterns in `--models`/`enabledModels` globs and package filters ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). The sandbox and gondolin example extensions now use versions without the open `zod` and `node-forge` advisories ([#37](https://github.com/embeputer/brian/pull/37))

## [0.2.1] - 2026-11-04

### Fixed

- `brian messages watch` and the `brian serve` gateway now decide on messages from other people with only the `memory_search` and `memory_write` tools, so a chat message can no longer get Brian to run commands or edit files. Your own brian chat keeps all tools ([#31](https://github.com/embeputer/brian/pull/31))
- The A2A server (used by the `brians` tool when `BRIAN_NAME`, `SANDBOX_NAME` or `BRIAN_A2A=1` is set) now requires `Authorization: Bearer <token>` and rejects requests whose `Host` is not its own address, so other local processes and DNS-rebinding pages can no longer prompt the agent. The token is shared through the discovery directory, which must be owned by the current user and is set to mode 0700. External A2A clients now need the token ([#32](https://github.com/embeputer/brian/pull/32))
- `webfetch` no longer falls back to the browser for blocked private, loopback or link-local URLs, and the browser fallback now runs in a separate headless Chromium whose traffic goes through a guard proxy, so redirects, popups, workers and DNS rebinding can no longer reach internal addresses such as `169.254.169.254` ([#33](https://github.com/embeputer/brian/pull/33))

## [0.2.0] - 2026-11-04

### Breaking Changes

- Custom `models.json` providers must use `"api": "brian-messages"` instead of `"api": "pi-messages"` ([#23](https://github.com/embeputer/brian/pull/23))

### Added

- `brian update` prints the installed version and the version published on npm before it updates ([#27](https://github.com/embeputer/brian/pull/27))

### Changed

- Updated the shipped model list: models providers retired are gone and new ones were added ([#25](https://github.com/embeputer/brian/pull/25))

### Fixed

- Updated `undici` to 8.12.2 for its TLS certificate validation bypass, cache poisoning and crash fixes ([GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx), [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm), [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26), [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)), and the bundled `body-parser` to 2.4.0 ([#24](https://github.com/embeputer/brian/pull/24))

### Removed

- Themes: the `--theme`, `--use-theme` and `--no-themes` flags, the `theme` and `themes` settings, the `themes` entry in package manifests, and the extension UI theme methods (`theme`, `getAllThemes`, `getTheme`, `setTheme`). The SDK no longer exports `initTheme` or `ReadonlyFooterDataProvider` ([#22](https://github.com/embeputer/brian/pull/22))

## [0.1.1] - 2026-10-26

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
