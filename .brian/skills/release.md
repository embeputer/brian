---
name: release
description: Prepare, publish, verify, and recover brian releases. Use for release preparation, local release smoke tests, publishing, and failed release CI or announcements.
---

# Releasing brian

Run repository commands from the repo root (two directories above this skill), unless instructed otherwise.

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

1. **Update CHANGELOGs**: ask the user whether they ran the `/cl` prompt on the latest commit on `main`. If not, they must run `/cl` first to audit and update each package's `[Unreleased]` section before releasing.

2. **Local smoke test**: build an unpublished release and smoke test from outside the repo (so it can't resolve workspace files):
   ```bash
   npm run release:local -- --out /tmp/brian-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/brian-local-release/node/brian --help
   /tmp/brian-local-release/node/brian --version
   /tmp/brian-local-release/node/brian --list-models
   /tmp/brian-local-release/node/brian -p "Say exactly: ok"
   /tmp/brian-local-release/node/brian

   # Bun binary smoke tests
   /tmp/brian-local-release/bun/brian --help
   /tmp/brian-local-release/bun/brian --version
   /tmp/brian-local-release/bun/brian --list-models
   /tmp/brian-local-release/bun/brian -p "Say exactly: ok"
   /tmp/brian-local-release/bun/brian
   ```
   Verify both Node and Bun startup, model/account listing, interactive startup, and at least one real prompt with the intended default provider. The bare commands `/tmp/brian-local-release/node/brian` and `/tmp/brian-local-release/bun/brian` start interactive mode; run each in tmux, submit a prompt, and wait for the model reply before considering the interactive smoke test passed. Failures are release blockers unless the user explicitly accepts the risk.

   Load and follow [interactive-testing.md](interactive-testing.md) for the tmux workflow. Start each release binary from `/tmp`, not the repo root.

3. **Run the release script**:
   ```bash
   BRIAN_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch    # fixes + additions
   BRIAN_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:minor    # breaking changes
   ```
   If the test suite already passed in `npm run release:local` and only fails from machine load, `BRIAN_RELEASE_SKIP_TESTS=1` skips `./test.sh` in the release script; checks and the packed install check still run. Use it only with the user's approval.

   Use `npm_config_min_release_age=0` only for the release command. The repo's normal npm age gate can otherwise block the release lockfile refresh when the current workspace package version was published recently. Review any lockfile, shrinkwrap, or install lock diffs the release creates before push.

   The release script bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, adds fresh `## [Unreleased]` changelog sections, commits `Add [Unreleased] section for next cycle`, then pushes `main` and the tag. Do not rerun the release script after a tag was pushed.

4. **CI publishes**: pushing the `vX.Y.Z` tag triggers `.github/workflows/build-binaries.yml`. It builds and smoke-tests the standalone binaries, runs checks and tests, publishes every public package with `scripts/publish.mjs` from environment `npm-publish`, then publishes the GitHub Release. npm auth is trusted publishing (GitHub Actions OIDC, with provenance) when configured, else the `NPM_TOKEN` repository secret.

5. **If CI publish fails**: inspect the failed job. The publish helper is idempotent and skips package versions already present on npm. Rerun the failed job or workflow after fixing CI or transient npm issues. Do not rerun `npm run release:patch` or `npm run release:minor` for the same version.

### First release (0.1.0)

`release.mjs` refuses to run until every package exists on npm, and trusted publishing can only be configured on an existing package, so the first release is tagged by hand:

1. On GitHub, create environment `npm-publish` and add an npm granular access token (publish rights for `@brian-agent`) as repository secret `NPM_TOKEN`.
2. `git tag v0.1.0 && git push origin v0.1.0` on `main`. CI builds and publishes everything.
3. On npmjs.com, for each `@brian-agent/*` package: Settings -> Trusted publishing -> GitHub Actions, repository `embeputer/brian`, workflow `build-binaries.yml`, environment `npm-publish`. Then delete the `NPM_TOKEN` secret and revoke the token.

`npm run publish` from a machine also works (`npm login` first; no provenance outside CI).
