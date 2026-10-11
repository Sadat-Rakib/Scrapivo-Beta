/**
 * WS7B — custom-signal injection into the deep pass, offline unit battery.
 *
 * Invariants:
 *   - the custom hunter fires ONLY the compiled searchQueries (same web
 *     ladder, same budget/concurrency/timeout machinery);
 *   - an evidence snippet counts ONLY on an observableIndicator match OR
 *     default verification; negativeIndicators veto the hit;
 *   - the isVerifiedSignalEvidence floor is never loosened;
 *   - default behavior is byte-identical when the option is absent.
 */
import { describe, expect, it, vi } from "vitest";
import { buildSpec, stated } from "@/lib/search/search-spec";
import type { SearchSpec } from "@/lib/search/search-spec";
import type { Evidence } from "@/lib/search/evidence";
import type { SpecRow } from "@/lib/spec-search.functions";
import type { CompiledCustomSignal } from "../custom-compiler";
import { CustomSignalSchema } from "../custom-compiler";
import { createCustomSignalHunter, finalQualify, runDeepSignalPass } from "../deep-pass.server";

const spec: SearchSpec = buildSpec({
  entity: "company",
  criteria: [stated("requested_service", "automation")],
  signal_required: true,
  signal_types: ["service_request"],
  raw_query: "companies with manual onboarding",
});

const optionalSpec: SearchSpec = buildSpec({
  entity: "company",
  criteria: [stated("industry", "software")],
  signal_required: false,
  raw_query: "software companies",
});

const compiled = (over: Partial<CompiledCustomSignal> = {}): CompiledCustomSignal =>
  CustomSignalSchema.parse({
    observableIndicators: ["manual onboarding", "manual process"],
    searchQueries: [
      '"manual onboarding" "looking for"',
      '"manual onboarding" hiring',
      'companies "manual onboarding"',
      '"manual process" "done by hand"',
      '"onboarding" complaints',
      '"manual entry" spreadsheet',
    ],
    evidenceRules: ["public post or page states the indicator for the subject"],
    negativeIndicators: [],
    ...over,
  });

const row = (over: Partial<SpecRow> = {}): SpecRow => ({
  kind: "company",
  title: "Acme Dynamics",
  detail: "Software company",
  entity_id: "company:acme",
  entity_resolved: true,
  page_type: "company_page",
  complete: true,
  ...over,
});

const ev = (over: Partial<Evidence> = {}): Evidence => ({
  source_url: "https://news.example/acme-needs-automation",
  source_type: "web",
  excerpt: "Acme Dynamics needs automation for manual onboarding",
  observed_at: new Date().toISOString(),
  evidence_type: "service_request",
  supports: "intent",
  confidence: 0.7,
  extraction_method: "searxng_snippet",
  subject: "company:acme",
  ...over,
});

/** All hits name the candidate (identity token of "Acme Dynamics" = "dynamics"). */
const hit = (text: string, url = "https://news.example/acme-post") => ({
  title: "Acme Dynamics thread",
  snippet: text,
  url,
});

describe("createCustomSignalHunter — queries", () => {
  it("fires ONLY the compiled searchQueries, split four per probe", async () => {
    const cs = compiled();
    const calls: string[][] = [];
    const hunter = createCustomSignalHunter(cs, {
      webSearch: async ({ queries }) => {
        calls.push(queries);
        return [];
      },
    });
    const deep = await runDeepSignalPass([row()], spec, { hunter });
    expect(calls).toEqual([cs.searchQueries.slice(0, 4), cs.searchQueries.slice(4, 6)]);
    expect(calls.flat().every((q) => cs.searchQueries.includes(q))).toBe(true);
    expect(calls.flat().some((q) => q.includes("Acme"))).toBe(false);
    expect(deep.hunterKind).toBe("default"); // explicit hunter injection wins
    expect(deep.probes).toBe(2);
    expect(deep.stillUnsignaled).toHaveLength(1);
  });

  it("a probe with no remaining compiled queries never touches the ladder", async () => {
    const cs = compiled({
      searchQueries: ['"manual onboarding" "looking for"', '"manual onboarding" hiring'],
    });
    const webSearch = vi.fn(async () => []);
    const hunter = createCustomSignalHunter(cs, { webSearch });
    const deep = await runDeepSignalPass([row()], spec, { hunter });
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(deep.probes).toBe(2);
  });
});

describe("createCustomSignalHunter — indicator-aware evidence scoring", () => {
  it("indicator match counts; a hit matching nothing is rejected", async () => {
    const hunter = createCustomSignalHunter(compiled(), {
      webSearch: async () => [
        hit("Acme Dynamics still does manual onboarding by hand and wants automation"),
        hit("Acme Dynamics bakes artisan sourdough on weekends"),
      ],
    });
    const deep = await runDeepSignalPass([row()], spec, { hunter });
    expect(deep.signalReady).toHaveLength(1);
    const attached = deep.signalReady[0]!.evidence ?? [];
    expect(attached).toHaveLength(1);
    expect(attached[0]!.extraction_method).toBe("custom_signal_indicator");
    expect(attached[0]!.subject).toBe("company:acme");
    expect(attached[0]!.evidence_type).toBe("service_request");

    // Full gate stays strict: subject-bound + claim-aligned + param-matched.
    const final = finalQualify({
      signalReady: deep.signalReady,
      alreadySignalRows: deep.stillUnsignaled,
      spec,
    });
    expect(final.qualified).toHaveLength(1);
    expect(final.qualified[0]!.entity_id).toBe("company:acme");
  });

  it("unrelated service evidence cannot satisfy the requested automation signal", async () => {
    const hunter = createCustomSignalHunter(compiled(), {
      webSearch: async () => [hit("Acme Dynamics is looking for a website redesign service")],
    });
    const deep = await runDeepSignalPass([row()], spec, { hunter });
    expect(deep.signalReady).toHaveLength(0);
    const attached = deep.stillUnsignaled[0]!.evidence ?? [];
    expect(attached[0]!.extraction_method).toBe("searxng_snippet");
  });

  it("negativeIndicators veto the hit even when the indicator matches", async () => {
    const cs = compiled({ negativeIndicators: ["switched to automation"] });
    const hunter = createCustomSignalHunter(cs, {
      webSearch: async () => [
        hit("Acme Dynamics does manual onboarding, but they switched to automation last year"),
        hit("Acme Dynamics struggles with manual onboarding and wants automation"),
      ],
    });
    const deep = await runDeepSignalPass([row()], spec, { hunter });
    expect(deep.signalReady).toHaveLength(1);
    const attached = deep.signalReady[0]!.evidence ?? [];
    expect(attached).toHaveLength(1);
    expect(attached[0]!.excerpt).toContain("struggles");
  });

  it("hiring cues in an indicator-matched hit keep the honest hiring type", async () => {
    const cs = compiled({ observableIndicators: ["manual onboarding", "growing team"] });
    const hunter = createCustomSignalHunter(cs, {
      webSearch: async () => [
        hit("Acme Dynamics is hiring while onboarding clients manually — growing team"),
      ],
    });
    const deep = await runDeepSignalPass([row()], spec, { hunter });
    expect(deep.signalReady).toHaveLength(0);
    const attached = deep.stillUnsignaled[0]?.evidence ?? [];
    expect(attached[0]!.evidence_type).toBe("hiring");
  });

  it("the verification floor is never loosened: non-http indicator evidence is discarded", async () => {
    const hunter = createCustomSignalHunter(compiled(), {
      webSearch: async () => [
        hit("Acme Dynamics does manual onboarding by hand", "ftp://files.example/post"),
      ],
    });
    const deep = await runDeepSignalPass([row()], spec, { hunter });
    expect(deep.signalReady).toHaveLength(0);
    expect(deep.stillUnsignaled).toHaveLength(1);
    expect(deep.stillUnsignaled[0]!.evidence).toBeUndefined();
  });
});

describe("runDeepSignalPass — customSignal option", () => {
  it("builds the custom hunter through customHunterFactory when customSignal is set", async () => {
    const cs = compiled();
    const factory = vi.fn(() =>
      createCustomSignalHunter(cs, {
        webSearch: async () => [
          hit("Acme Dynamics complains about manual onboarding every week and wants automation"),
        ],
      }),
    );
    const deep = await runDeepSignalPass([row()], spec, {
      customSignal: cs,
      customHunterFactory: factory,
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(cs);
    expect(deep.hunterKind).toBe("custom");
    expect(deep.signalReady).toHaveLength(1);
  });

  it("an explicit hunter still wins over customSignal; the factory is never consulted", async () => {
    const factory = vi.fn(() => createCustomSignalHunter(compiled()));
    const deep = await runDeepSignalPass([row()], spec, {
      hunter: async () => [ev()],
      customSignal: compiled(),
      customHunterFactory: factory,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(deep.hunterKind).toBe("default");
    expect(deep.signalReady).toHaveLength(1);
  });

  it("customHunterFactory without customSignal is ignored (default path unchanged)", async () => {
    const factory = vi.fn(() => createCustomSignalHunter(compiled()));
    const deep = await runDeepSignalPass([row()], spec, {
      hunter: async () => [ev()],
      customHunterFactory: factory,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(deep.signalReady).toHaveLength(1);
  });

  it("signal-optional specs stay a no-op even with customSignal set", async () => {
    const webSearch = vi.fn(async () => [hit("Acme Dynamics manual onboarding")]);
    const deep = await runDeepSignalPass([row()], optionalSpec, {
      customSignal: compiled({
        searchQueries: ['"manual onboarding"'],
      }),
      customHunterFactory: (cs) => createCustomSignalHunter(cs, { webSearch }),
    });
    expect(webSearch).not.toHaveBeenCalled();
    expect(deep.probes).toBe(0);
    expect(deep.alreadyVerified).toHaveLength(1);
    expect(deep.signalReady).toHaveLength(0);
  });
});
