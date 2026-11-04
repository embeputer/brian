# Changelog

## [Unreleased]

## [0.2.3] - 2026-11-04

## [0.2.2] - 2026-11-04

## [0.2.1] - 2026-11-04

## [0.2.0] - 2026-11-04

### Breaking Changes

- The `pi-messages` API id is now `brian-messages`. Custom `models.json` providers and SDK callers that set `api: "pi-messages"` must use `"brian-messages"` ([#23](https://github.com/embeputer/brian/pull/23))

### Changed

- Refreshed shipped provider model data: drops models providers retired (OpenRouter `openai/o1`, `o3-mini`, `o4-mini`, `gpt-4-turbo`, Poolside Laguna 2.1, and others; NVIDIA `z-ai/glm-5.3`; OpenCode `nemotron-3-ultra-free`; three Vercel AI Gateway models) and adds new ones

## [0.1.1] - 2026-10-26

### Changed

- Provider model data is committed and only changes through `npm run generate:models`, so releases ship the data they were tested with ([#19](https://github.com/embeputer/brian/pull/19))

### Removed

- The Radius provider and its OAuth flow ([#20](https://github.com/embeputer/brian/pull/20))

## [0.1.0] - 2026-10-26

Initial Brian release, forked from pi 1.3.0. For earlier history, see [pi's changelog](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/CHANGELOG.md).
