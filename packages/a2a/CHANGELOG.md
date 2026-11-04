# Changelog

## [Unreleased]

### Breaking Changes

- `createA2aServer` requires `Authorization: Bearer <token>` on JSON-RPC calls (`server.token`, or the `token` option) and rejects requests whose `Host` is not the server's own address; `delegateToA2aAgent*` take a `token` option. `LocalA2aDiscovery` stores the token in each lease and refuses a discovery directory owned by another user ([#32](https://github.com/embeputer/brian/pull/32))

## [0.1.1] - 2026-10-26

## [0.1.0] - 2026-10-26

Initial Brian release, forked from pi 1.3.0. For earlier history, see [pi's changelog](https://github.com/earendil-works/pi/blob/v1.3.0/packages/a2a/CHANGELOG.md).
