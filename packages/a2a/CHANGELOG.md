# Changelog

## [Unreleased]

## [0.2.2] - 2026-11-04

## [0.2.1] - 2026-11-04

### Fixed

- `createA2aServer` now requires `Authorization: Bearer <token>` (`server.token`, or `options.token`) on every request except the agent card, and rejects requests whose `Host` is not the server's own address (`options.allowedHosts` adds more). `LocalA2aDiscovery` stores the token in the peer lease and refuses a discovery directory that is a symlink or owned by another user ([#32](https://github.com/embeputer/brian/pull/32))

## [0.2.0] - 2026-11-04

## [0.1.1] - 2026-10-26

## [0.1.0] - 2026-10-26

Initial Brian release, forked from pi 1.3.0. For earlier history, see [pi's changelog](https://github.com/earendil-works/pi/blob/v1.3.0/packages/a2a/CHANGELOG.md).
