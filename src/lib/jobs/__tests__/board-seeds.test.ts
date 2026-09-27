/**
 * Board-directory seed import (seeds/board-directory-2026-09-25.json) —
 * discovery intelligence, not truth: live rows preferred, unverified rows are
 * low-priority backfill that must never read as verified, suspect rows never
 * surface, existing board-pool caps respected, licence attribution present.
 */
import { describe, expect, it } from "vitest";
import {
  BOARD_SEED_ATTRIBUTION,
  loadBoardSeedRows,
  loadBoardSeedSources,
  seedBoardStatus,
  seedBoardsFor,
} from "../tenants";
import { JOB_BOARD_CAPS, pooledBoardsFor } from "../ats-adapters";

describe("loadBoardSeedRows", () => {
  it("loads the static seed file (3,581 rows, known statuses)", () => {
    const rows = loadBoardSeedRows();
    expect(rows).toHaveLength(3581);
    for (const r of rows) {
      expect(["live", "suspect", "unverified"]).toContain(r.status);
      expect(r.slug).toBeTruthy();
      expect(["greenhouse", "ashby", "lever", "personio", "teamtailor", "gem"]).toContain(r.ats);
    }
  });

  it("exposes the file's own source/licence records (JobSync, MIT)", () => {
    const sources = loadBoardSeedSources();
    const jobsync = sources.find((s) => /jobsync/i.test(s.id));
    expect(jobsync).toBeDefined();
    expect(jobsync?.licence).toBe("MIT");
  });

  it("carries the licence attribution string for code-level provenance", () => {
    expect(BOARD_SEED_ATTRIBUTION).toMatch(/JobSync/);
    expect(BOARD_SEED_ATTRIBUTION).toMatch(/MIT/i);
    expect(BOARD_SEED_ATTRIBUTION).toMatch(/gsync/);
  });
});

describe("seedBoardsFor / seedBoardStatus", () => {
  it("prefers live rows: every live slug precedes every unverified slug", () => {
    for (const provider of ["greenhouse", "ashby", "lever"]) {
      const boards = seedBoardsFor(provider);
      const status = seedBoardStatus(provider);
      const lastLive = boards.reduce((acc, b, i) => (status.get(b) === "live" ? i : acc), -1);
      const firstUnverified = boards.findIndex((b) => status.get(b) === "unverified");
      if (firstUnverified >= 0) expect(lastLive).toBeLessThan(firstUnverified);
      expect(lastLive).toBeGreaterThanOrEqual(0); // provider has live rows
    }
  });

  it("never surfaces suspect rows and never marks unverified as live", () => {
    const rows = loadBoardSeedRows();
    const providers = [...new Set(rows.map((r) => r.ats))];
    for (const p of providers) {
      const status = seedBoardStatus(p);
      for (const s of status.values()) expect(s === "live" || s === "unverified").toBe(true);
      const suspects = rows.filter((r) => r.ats === p && r.status === "suspect");
      for (const s of suspects) expect(seedBoardsFor(p)).not.toContain(s.slug);
    }
  });

  it("returns nothing for providers the seed file does not cover", () => {
    expect(seedBoardsFor("personio")).toEqual([]);
    expect(seedBoardsFor("teamtailor")).toEqual([]);
    expect(seedBoardsFor("gem")).toEqual([]);
    expect(seedBoardsFor("nonsense-provider")).toEqual([]);
  });
});

describe("board pool merge (pooledBoardsFor)", () => {
  it("respects existing per-provider caps and contains no duplicates", async () => {
    for (const provider of ["greenhouse", "ashby", "lever"] as const) {
      const boards = await pooledBoardsFor(provider);
      expect(boards.length).toBeLessThanOrEqual(JOB_BOARD_CAPS[provider]);
      expect(new Set(boards).size).toBe(boards.length);
      expect(boards).not.toContain("netflix");
      expect(boards).not.toContain("notion");
    }
  });

  it("seed-live boards reach the pool ahead of unverified backfill", async () => {
    // Ashby: catalog (250) + tenants (250) both exceed the cap (90) on their
    // own, so without seed priority the directory import would be dead weight.
    const boards = await pooledBoardsFor("ashby");
    const status = seedBoardStatus("ashby");
    const withStatus = boards.filter((b) => status.has(b));
    expect(withStatus.length).toBeGreaterThan(0);
    const lastLive = withStatus.reduce(
      (acc, b, i) => (status.get(b) === "live" ? i : acc),
      -1,
    );
    const firstUnverified = withStatus.findIndex((b) => status.get(b) === "unverified");
    if (firstUnverified >= 0) expect(lastLive).toBeLessThan(firstUnverified);
  });

  it("new ATS families start with an empty pool (boards arrive via DB/catalog/seeds)", async () => {
    expect(await pooledBoardsFor("personio")).toEqual([]);
    expect(await pooledBoardsFor("teamtailor")).toEqual([]);
    expect(await pooledBoardsFor("gem")).toEqual([]);
  });
});
