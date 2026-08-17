# Releasing

npm packages in this monorepo publish **from CI on a version tag** — no local `npm publish`, no
OTP juggling. The workflow is [`.github/workflows/release.yml`](.github/workflows/release.yml).

## One-time setup

1. Create an npm **Automation** access token: npmjs.com → *Access Tokens* → *Generate New Token* →
   **Automation**. Automation tokens skip the 2FA/OTP prompt that CI can't answer.
2. Add it as a repo secret: **Settings → Secrets and variables → Actions → New repository secret**,
   name it `NPM_TOKEN`.
3. The token's npm account must be a maintainer of each package it publishes.

That's it — provenance uses GitHub's OIDC (`id-token: write`), no extra secret.

## Cutting a release

Tags are `<package-name>@<version>`. Bump the version, commit, tag, push the tag:

```sh
# example: release helix-noise-gpu 0.1.1
cd packages/gpu
npm version 0.1.1 --no-git-tag-version      # bump package.json only (no auto commit/tag)
# update CHANGELOG.md: add the 0.1.1 heading with today's date
cd ../..
git commit -am "helix-noise-gpu 0.1.1"
git tag helix-noise-gpu@0.1.1
git push && git push origin helix-noise-gpu@0.1.1
```

Pushing the tag fires `release.yml`, which:

1. resolves the package directory from the tag and **fails if the tag version ≠ `package.json`**,
2. installs (`npm ci` if a lockfile is committed, else `npm install`), builds, and runs the tests,
3. `npm publish --provenance --access public`,
4. creates a GitHub Release for the tag with auto-generated notes.

Watch it under the repo's **Actions** tab; the published package shows a provenance badge on npm.

> **The tagged commit must contain `release.yml`.** Tag-triggered workflows run the workflow file
> *as of the tag*. The first release after adding this workflow must be tagged on a commit that
> already includes it.

## Covered packages

| tag prefix | package | directory | registry | secret |
|---|---|---|---|---|
| `helix-noise@` | `helix-noise` | `packages/js` | npm | `NPM_TOKEN` |
| `helix-noise-r3f@` | `helix-noise-r3f` | `packages/r3f` | npm | `NPM_TOKEN` |
| `helix-noise-gpu@` | `helix-noise-gpu` | `packages/gpu` | npm | `NPM_TOKEN` |
| `helix-noise-wasm@` | `helix-noise-wasm` | `packages/wasm` | npm (via wasm-pack) | `NPM_TOKEN` |
| `helix-noise-crate@` | `helix-noise` (crate) | `packages/rust` | crates.io | `CARGO_REGISTRY_TOKEN` |
| `helix-noise-py@` | `helix-noise` (PyPI) | `packages/python` | PyPI | **none** — trusted publishing |

> The crate uses the `helix-noise-crate@` prefix, **not** `helix-noise@`: the crates.io crate and the
> npm js package share the name `helix-noise`, so the bare tag is reserved for the npm package. For
> wasm and the crate the version lives in `Cargo.toml` (not `package.json`); the workflow checks it there.

Example — release the crate bump that's already staged locally (`packages/rust` is `0.2.0`, crates.io
has `0.1.0`):

```sh
git tag helix-noise-crate@0.2.0
git push origin helix-noise-crate@0.2.0
```

## PyPI — one-time setup (no token)

PyPI publishes through **trusted publishing**: GitHub proves the workflow's identity over OIDC and
PyPI accepts the upload, so there is no `PYPI_TOKEN` to create, store, leak, or rotate. That setup
lives on PyPI, not in this repo, and only you can do it:

> pypi.org → the `helix-noise` project → **Manage** → **Publishing** → *Add a new publisher*
>
> | field | value |
> |---|---|
> | Owner | `rifmj` |
> | Repository | `helix-noise` |
> | Workflow name | `release.yml` |
> | Environment name | `pypi` |

The environment name must match the `environment: pypi` in the `publish-pypi` job. If the project
did not exist on PyPI yet you would add a *pending* publisher instead, from your account's
*Publishing* page — but `helix-noise` is already there at `0.1.0`, so use the project page.

Until that publisher exists the job fails at the upload step with an OIDC error and **nothing is
published** — a failed release, not a partial one.

Then release exactly like the others:

```sh
git tag helix-noise-py@0.6.0
git push origin helix-noise-py@0.6.0
```

## Not yet automated

- Nothing. Every package in the table above releases from a tag.
