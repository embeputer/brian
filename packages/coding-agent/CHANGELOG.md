# Changelog

## [Unreleased]

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
