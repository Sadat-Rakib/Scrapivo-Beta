/** Phase 1.5: phone-country safety battery + serve-time enforcement proof. */
import { describe, expect, it } from "vitest";
import { checkPhone } from "@/lib/search/phone-safety";
import { runSpecSearchCore } from "../spec-search.functions";

describe("checkPhone", () => {
  it("matching country code passes", () => {
    expect(checkPhone("+919673273488", "IN")).toEqual({ phone: "+919673273488", status: "ok" });
    expect(checkPhone("+15129472491", "US")).toMatchObject({ status: "ok" });
    expect(checkPhone("+442071234567", "GB")).toMatchObject({ status: "ok" });
  });
  it("wrong-country code hides (the Pune +1 case)", () => {
    expect(checkPhone("+12065621006", "IN")).toEqual({ phone: null, status: "mismatch-hidden" });
    expect(checkPhone("+442071234567", "IN")).toMatchObject({ status: "mismatch-hidden" });
    expect(checkPhone("+919673273488", "US")).toMatchObject({ status: "mismatch-hidden" });
  });
  it("never hides on doubt: no plus, unknown country, empty", () => {
    expect(checkPhone("020 7946 0018", "GB")).toMatchObject({ status: "unverifiable" });
    expect(checkPhone("+12065621006", "XX")).toMatchObject({ status: "unverifiable" });
    expect(checkPhone("+12065621006", "")).toMatchObject({ status: "unverifiable" });
    expect(checkPhone("", "IN").phone).toBeNull();
    expect(checkPhone(null, "IN").phone).toBeNull();
  });
  it("garbage short numbers hide as invalid", () => {
    expect(checkPhone("+84", "VN")).toEqual({ phone: null, status: "invalid-hidden" });
  });
  it("formatting characters are ignored for the check", () => {
    expect(checkPhone("+1 (512) 947-2491", "US")).toMatchObject({ status: "ok" });
    expect(checkPhone("+1 (512) 947-2491", "IN")).toMatchObject({ status: "mismatch-hidden" });
  });
});

describe("serve-time enforcement", () => {
  it("S3 business mapper suppresses mismatched phones with a flag", async () => {
    const fake = (async () => ({
      rows: [{
        name: "Bad Phone Dental", category: "dentist", locality: "Pune",
        region: "MH", country: "IN", address: "1 FC Rd", phone: "+12065621006",
      }],
      meta: {
        dbHit: true, engine: "s3-parquet", partitionsRead: ["fake"],
        rowsScanned: 1, rowsReturned: 1,
      },
    })) as never;
    const res = await runSpecSearchCore(
      "dentists in Pune", { businesses: fake, index: null }, 25,
      { mode: "looking" },
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].phone).toBeNull();
    expect(res.rows[0].phoneStatus).toBe("mismatch-hidden");
  });
});
