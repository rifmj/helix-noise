# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.6.1]

- **`flutter` was silently ignored.** `field_options` never read the key, so
  `new Field({ flutter: 0.5 })` built a field with no flutter at all and reported no error —
  measured against the reference fixture's `R_flutter` config, the published `0.6.0` was off by
  `1.72` on a signal of order 1, while `A_default_small`, `B_helical_coherent` and `E_tileable`
  agreed to `4e-16`. Every other non-callable option was read; `flutter` was the single gap.
- **The parity test could not have caught it**, which is why it shipped: its config list covered 8
  of the 13 spectral configs and `R_flutter` was not among them. It is now included (876 values
  checked, up from 803). The three still excluded — `M_coherence_k`, `N_helicity_k`, `O_shellpeak` —
  are excluded on purpose and now say so: their options are callables, which cannot cross the
  JS→wasm boundary. `spectrum`, `coherence_fn` and `helicity_fn` are, for the same reason, the only
  `HelixOptions` fields these bindings do not accept.

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
