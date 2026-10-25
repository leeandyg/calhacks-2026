# Parallel world creation implementation plan

Goal: issue #121 — concurrently create environment and source assets, rendering either completed branch immediately while the other runs.

Architecture: new self-hosted creation sessions launch two SDK queries with isolated working directories, a common fixed grid/palette brief and separate manifest names. Both use the existing WorldOutput shape. Publish signed, validated branch results through the existing proxy and merge the unchanged final manifest after both finish. Edits and legacy cloud sessions retain their existing path.

- [ ] Worker: gated tests prove both jobs start before either finishes, publication occurs in either order, failed output stays private, sessions remain resumable, and final output merges both branches.
- [ ] API: accept only environment/objects branch selectors; validate branch invariants and compiled mappings with the existing scene/asset validation.
- [ ] Browser: consume ready events, decode/install each branch, reveal immediately, preserve manual state on later arrivals, and avoid applying the final creation a second time.
- [ ] Verify deterministic browser cases for each completion order, partial failure and reconnect; run build, unit and frontend gates. Rebuild the local worker only when idle.

Constraints: no scene.ts changes; canonical terrain and positions remain store-owned; sound IDs remain resolver-owned; generated code runs only in the worker container. Partial success stays visible on a later failure. Generation overlap, rather than a fixed 2x claim, is the latency acceptance condition.
