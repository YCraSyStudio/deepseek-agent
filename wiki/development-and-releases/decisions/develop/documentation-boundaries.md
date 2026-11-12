[Back](2.INDEX.MD)

# DDR 003 · Documentation Boundaries

## Context

Contributors need implementation detail that is too low-level for extension users, while the public site needs stable, translated guidance. The public site is built from Astro sources and committed as generated HTML.

## Decision

Keep `wiki/` as the technical source for contributors and maintainers. Keep `web-doc/` as the public Astro source and `docs/` as its generated output; do not edit generated files by hand.

Update the wiki in the same commit as the code it describes. Build the public site for user-visible changes and commit the regenerated `docs/` output with the `web-doc/` change.

## Consequences

Some behavior is intentionally described in both places, with different depth and audience. Internal contracts, invariants and maintenance procedures stay in the wiki; installation, settings and user workflows stay in the public documentation. A change that affects both must keep the wording consistent, and a public change is incomplete until the Astro build succeeds. See the [repository structure](../../../architecture/repository-structure.md) and [verification](../../verification.md#web-documentation) for the paths and build check.

[Back](2.INDEX.MD)
