# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.6.0]

- **`version()` reported someone else's version.** It returned the wrapped crate's `VERSION`, which
  is a different number on a different release cycle: `npm i helix-noise-wasm@0.6.0` answered
  `"1.1.0"`, and once the crate's own constant was corrected it would have answered `"0.7.0"` —
  still not this package's. `version()` now returns this package's version, derived from
  `CARGO_PKG_VERSION`, and the parity test asserts it against `pkg/package.json`.
- **New `spec_version()`** (`"1.11.3"`) — the revision of the JS reference the wrapped core is
  verified against, inherited from the crate because these bindings return the crate's numbers.
  `tests/parity.test.mjs` pins it to the `$spec_version` key now recorded in
  `spec/parity_fixture.json`, so regenerating the fixture from a newer reference fails the test
  until someone re-verifies.
- **New `core_version()`** keeps the wrapped crate's own version reachable, now that `version()`
  reports this package's.

Earlier releases of this package predate the changelog; the wrapped field algorithm's history is
`packages/rust/CHANGELOG.md`, and the reference's is `packages/js/CHANGELOG.md`.
