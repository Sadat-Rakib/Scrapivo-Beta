/** Typed, sanitized worker errors. Messages never include paths, tokens or raw Playwright text. */
export type WorkerErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_BODY"
  | "BODY_TOO_LARGE"
  | "INVALID_URL"
  | "INVALID_SESSION"
  | "INVALID_INPUT"
  | "INVALID_SELECTOR"
  | "BLOCKED_URL"
  | "DNS_UNAVAILABLE"
  | "NAVIGATION_FAILED"
  | "READ_FAILED"
  | "BROWSER_UNAVAILABLE"
  | "SESSION_NOT_FOUND"
  | "SESSION_CLOSED"
  | "SESSION_LIMIT"
  | "PROFILE_LIMIT"
  | "FORBIDDEN_OWNER"
  | "HUMAN_CONTROL"
  | "NOT_IN_CONTROL"
  | "STALE_SNAPSHOT"
  | "CANCELLED"
  | "WORKER_FAILURE";

export class WorkerError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}
