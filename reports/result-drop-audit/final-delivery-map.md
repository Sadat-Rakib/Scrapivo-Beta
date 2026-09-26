# Final delivery map

1. `src/lib/spec-search.functions.ts:~1880-1910`: final `applyWhyMatchGate(completeRows, spec, signal_required)` invokes `applyQualificationGate(..., keepPotential:false)`. Only `disposition === "qualified"` remains. A qualification import error clears the pool; cancellation returns an empty `SEARCH_CANCELLED` response.
2. `src/lib/spec-search.functions.ts:~1920-1960`: verified stamp/write-back is best effort and does not block UI. `markSoftDuplicates` annotates; it does not remove rows.
3. `src/lib/spec-search.functions.ts:561,~1960`: `applyPage` slices qualified rows by offset/limit. A valid row can be off the requested page, with `hasMore` set. `SpecSearchResult.rows = page`; `qualified_count = page.length`.
4. `src/lib/spec-search.functions.ts:~2070` `runSpecSearch`: authenticated server function returns that result under the registered run ID and abort signal.
5. `src/routes/_authenticated/discover.tsx:683-707`: route awaits `runSpec`; rejects a response whose run ID is no longer active or whose turn ID changed. Clarification branch returns before row projection.
6. `src/lib/search/qualified-lead-view.ts:184` `projectSpecRowsToQualifiedViews`: iterates server rows and calls `projectQualifiedLead`. Failed projections go into local `rejected[]`, not `views[]`. The UI currently uses `views`, not raw `res.rows`.
7. `src/lib/search/qualified-lead.ts:~140-305` `canPersistAsQualifiedLead`/`projectQualifiedLead`: rechecks disposition, stable/resolved identity, `qualifyLead`, theorem and required signal proof. This is a **second delivery gate**. A server row can be dropped here if these checks fail; ordinary matching code/spec should give the same decision, but the route does not surface `projected.rejected` to the user.
8. `src/routes/_authenticated/discover.tsx:716-760`: a business Spec maps views to `LocalBusinessRow[]`; other Specs map views to legacy `Lead[]`. It writes the active turn's `results`. Company/person Spec results therefore render through the posts/lead card section on this path, while business results use the local grid/table. `projected.qualified_count`, not server `qualified_count`, drives the visible result count and outcome toast.
9. `src/routes/_authenticated/discover.tsx:1690-1800` `renderResultSections`: renders only nonempty turn arrays. Current turn is open by default; older turns may be folded. Cards/tables live in `src/components/discover/result-tabs.tsx` and `src/components/lead-card.tsx`.

## Can a server-qualified row fail to appear?

**Yes.** The response may be intentionally discarded as stale (`discover.tsx:697`); the UI projection can reject a row on repeated qualification/persistence checks (`qualified-lead-view.ts:184`); pagination can place it off the current page; or an older turn may be folded. For the active, current response with a successful projection and offset in range, the route stores it in `leads` or `local` and the corresponding nonempty section renders. Existing B/C core logs prove server rows, **not** actual rendered cards; no UI automation was run in those logs.

The projection is not the observed first zero boundary for A6: its server response already had `rows:[]` after `SEARCH_CANCELLED`. It remains a real second gate for other runs and should be inspected when server `rows.length > 0` but the UI shows zero.
