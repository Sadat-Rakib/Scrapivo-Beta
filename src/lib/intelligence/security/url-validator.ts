/**
 * Scrapivo — SSRF Protection & URL Validator
 *
 * Blocks requests to internal/private IP ranges and enforces strict URL
 * validation for all external web intelligence requests.
 *
 * §30: Treat all external content as untrusted. Protect against SSRF,
 * prompt injection, malicious HTML, arbitrary URL access, and credential leakage.
 */

const PRIVATE_IP_RANGES = [
  // Loopback
  /^127\./,
  /^0\.0\.0\.0/,
  // Private Class A
  /^10\./,
  // Private Class B
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  // Private Class C
  /^192\.168\./,
  // Link-local
  /^169\.254\./,
  // Cloud metadata endpoints (AWS, GCP, Azure)
  /^169\.254\.169\.254/,
  /^metadata\.google\.internal/,
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export interface UrlValidationResult {
  valid: boolean;
  sanitized_url?: string;
  error?: string;
}

/**
 * Validates and sanitizes a URL for safe external requests.
 * Blocks internal IPs, private ranges, cloud metadata endpoints,
 * and non-HTTP(S) schemes.
 */
export function validateExternalUrl(raw: string): UrlValidationResult {
  if (!raw || typeof raw !== "string") {
    return { valid: false, error: "Empty or non-string URL" };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, error: "Empty URL" };
  }

  let parsed: URL;
  try {
    // Prepend https:// if no scheme
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withScheme);
  } catch {
    return { valid: false, error: `Invalid URL: ${trimmed}` };
  }

  // Check scheme
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      valid: false,
      error: `Blocked scheme: ${parsed.protocol} (only http/https allowed)`,
    };
  }

  // Check hostname against blocklist
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: `Blocked hostname: ${hostname}` };
  }

  // Check against private IP ranges
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(hostname)) {
      return {
        valid: false,
        error: `Blocked private IP range: ${hostname}`,
      };
    }
  }

  // Block numeric-only hostnames (potential IP bypass)
  if (/^\d+$/.test(hostname)) {
    return { valid: false, error: `Blocked numeric-only hostname: ${hostname}` };
  }

  return { valid: true, sanitized_url: parsed.href };
}

/**
 * Sanitizes scraped text content to prevent prompt-injection attacks.
 * Strips HTML script/style tags and removes potential instruction injections.
 */
export function sanitizeScrapedText(raw: string): string {
  if (!raw || typeof raw !== "string") return "";

  return (
    raw
      // Remove script tags and their content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      // Remove style tags and their content
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      // Remove HTML tags
      .replace(/<[^>]+>/g, " ")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
      // Truncate excessively long content
      .slice(0, 50_000)
  );
}

/**
 * Normalizes a domain string for entity resolution.
 * Strips protocol, www prefix, and trailing paths.
 */
export function normalizeDomain(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .trim();
}

/**
 * Normalizes a phone number for entity resolution.
 * Strips all non-digit characters and keeps the last 10 digits.
 */
export function normalizePhone(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/\D/g, "").slice(-10);
}

/**
 * Normalizes a company name for fuzzy matching.
 * Strips suffixes like Inc, LLC, Ltd, Corp and non-alphanumeric characters.
 */
export function normalizeCompanyName(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company|the|group|holdings?)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
