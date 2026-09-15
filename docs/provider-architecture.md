# Provider architecture

Part of the PROP-23 platform upgrade (see `platform-upgrade-spec.md`).

## Layout

```
lib/providers/
  types.ts         normalized schemas + capability interfaces
  registry.ts      flags, priority config, firstResult() fallback cascade
  mock.ts          demo-mode providers (fictional Cincinnati-area fixtures)
  regrid.ts        address typeahead (ll_uuid) + parcel lookup
  rentcast.ts      property records, sale/rental listings, rent AVM+comps,
                   sale comps, taxes
  attomAdapter.ts  secondary property/rent-AVM/tax via existing lib/attom.ts
```

## Rules

- Vendor JSON is normalized inside the adapter; nothing vendor-shaped
  crosses the module boundary. Raw payloads may ride along in `raw` only
  where provider terms permit storage.
- Keys live server-side (`RENTCAST_API_KEY`, `REGRID_API_KEY`,
  `ATTOM_API_KEY`, `MLS_PROVIDER_API_KEY`); the browser only ever calls
  PropPencil API routes.
- A provider is active iff its key is present, unless explicitly forced
  with `ENABLE_<NAME>=0|1`. Priority per capability is configuration
  (`PROVIDER_PRIORITY_JSON`), defaulting to
  property/rental: rentcast → attom → mock; listing: mls → rentcast →
  mock; address/parcel: regrid → mock.
- `firstResult(capability, fn)` walks the priority list: provider errors
  log (`provider_failed`) and fall through; only an all-empty walk returns
  null. Callers therefore never crash on vendor failure and must render an
  honest missing-data state (spec §38).
- The mock adapter registers unconditionally and last, so a keyless
  checkout (CI, demo) still runs the full product flow. Mock fixtures use
  fictional addresses by policy and include a deliberate rent outlier per
  market so the rent engine's trimming is demonstrable.

## Still to come (tickets)

Identity/matching + schema (PROP-25), autocomplete route + UX (PROP-26),
listing discovery/URL resolution (PROP-28), rent intelligence engine
(PROP-29), provenance/conflicts/overrides (PROP-30), cache/resilience/
observability on this layer (PROP-31), enrichment pipeline + UI
(PROP-32/33), S8/expenses (PROP-34), underwriting wiring (PROP-35),
tests/docs (PROP-36).
