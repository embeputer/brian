# Contributing to Brian

## The One Rule

**You must understand your code.** If you cannot explain what your changes do and how they interact with the rest of the system, your PR will be closed. Using AI to write code is fine; submitting code you do not understand is not.

If you use an agent, run it from the repository root so it picks up `AGENTS.md`, and make it follow that file.

## Issues

Use one of the issue templates. Keep it short and concrete: what happened, how to reproduce it, and why it matters. Say so if you want to implement the change yourself.

## Pull Requests

Before submitting a PR:

```bash
npm run check
./test.sh
```

Both must pass.

Do not edit `CHANGELOG.md`. Changelog entries are added by maintainers.

If you are adding a new provider to `packages/ai`, see `AGENTS.md` for required tests.
