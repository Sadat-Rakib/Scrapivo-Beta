/**
 * Crypto tests (Workstream 6) — AES-256-GCM roundtrip + fail-closed key rule.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  NotificationsKeyError,
  decryptCredentials,
  encryptCredentials,
  notificationsKeyConfigured,
} from "../crypto.server";

const KEY_HEX = "ab".repeat(32);
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

const ORIGINAL_KEY = process.env.SCRAPIVO_NOTIFICATIONS_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SCRAPIVO_NOTIFICATIONS_KEY;
  else process.env.SCRAPIVO_NOTIFICATIONS_KEY = ORIGINAL_KEY;
});

describe("notifications crypto", () => {
  it("roundtrips a credentials object (hex key)", () => {
    process.env.SCRAPIVO_NOTIFICATIONS_KEY = KEY_HEX;
    const creds = { webhook_url: "https://hooks.slack.com/services/T000/B000/xyz", email: "a@b.c" };
    const blob = encryptCredentials(creds);
    expect(blob).not.toContain("hooks.slack.com");
    expect(decryptCredentials<typeof creds>(blob)).toEqual(creds);
  });

  it("roundtrips with a base64 key and produces unique ciphertexts per call", () => {
    process.env.SCRAPIVO_NOTIFICATIONS_KEY = KEY_B64;
    const creds = { email: "me@example.com" };
    const a = encryptCredentials(creds);
    const b = encryptCredentials(creds);
    expect(a).not.toEqual(b); // random IV
    expect(decryptCredentials(a)).toEqual(creds);
    expect(decryptCredentials(b)).toEqual(creds);
  });

  it("rejects a tampered ciphertext instead of returning partial data", () => {
    process.env.SCRAPIVO_NOTIFICATIONS_KEY = KEY_HEX;
    const blob = Buffer.from(encryptCredentials({ email: "x@y.z" }), "base64");
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptCredentials(blob.toString("base64"))).toThrow();
  });

  it("refuses to save (encrypt) when the key env is unset or malformed", () => {
    delete process.env.SCRAPIVO_NOTIFICATIONS_KEY;
    expect(notificationsKeyConfigured()).toBe(false);
    expect(() => encryptCredentials({ email: "x@y.z" })).toThrow(NotificationsKeyError);
    process.env.SCRAPIVO_NOTIFICATIONS_KEY = "too-short";
    expect(() => encryptCredentials({ email: "x@y.z" })).toThrow(NotificationsKeyError);
  });

  it("refuses to decrypt when the key is missing (fail closed, no garbage)", () => {
    process.env.SCRAPIVO_NOTIFICATIONS_KEY = KEY_HEX;
    const blob = encryptCredentials({ email: "x@y.z" });
    delete process.env.SCRAPIVO_NOTIFICATIONS_KEY;
    expect(() => decryptCredentials(blob)).toThrow(NotificationsKeyError);
  });
});
