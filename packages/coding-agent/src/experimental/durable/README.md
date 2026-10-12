# durable

Headless experimental runtime built on `@punch-bot/durable`. Import `openDurable` from
`runtime.ts` to open a session, subscribe to its view, and submit work through its controller.
Call `close()` when finished. Pass `continueSession: true` to resume the newest session.

The runtime shares pi model credentials and settings. Session selection (`sessions.ts`),
the pi prompt (`prompt.ts`), and harness setup (`harness-setup.ts`) live in this directory;
SQLite storage and `CodingTools` come from `@punch-bot/durable`.
Punch keeps terminal UI entrypoints removed.
