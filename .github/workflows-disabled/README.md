These workflows are disabled on `embeputer/brian`.

GitHub Actions only runs YAML under `.github/workflows/`. Move a file there to turn it on.

- `ci.yml`: build, check and test on pushes and PRs to `main`.
- `env.yml`: `brian-env` daemon checks.
- `npm-audit.yml`: scheduled `npm audit` of published dependencies.
