export type BrowserFriction =
  | "LOGIN_WALL"
  | "CAPTCHA"
  | "MODAL"
  | "COOKIE_BANNER"
  | "RATE_LIMIT"
  | "ACCESS_BLOCK";

export interface BrowserElement {
  ref: string;
  role: string;
  name: string;
  state: string[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  pageType: "search_results" | "entity_detail" | "directory" | "feed" | "form" | "error" | "unknown";
  headings: string[];
  visibleRelevantText: string;
  interactiveElements: BrowserElement[];
  links: Array<{ ref: string; name: string; url: string | null }>;
  selectedFilters: string[];
  loadingState: "loading" | "complete" | "error";
  friction: BrowserFriction[];
  screenshotRef?: string | null;
}

export interface BrowserObservation {
  snapshot: PageSnapshot;
  action: string;
  expectedState?: string | null;
  verified: boolean;
}

export interface BrowserSession {
  id: string;
  visible: boolean;
  createdAt: string;
  screenshotDirectory: string;
  counters: {
    actions: number;
    pages: number;
    scrolls: number;
    screenshots: number;
    reasoningCalls: number;
  };
  limits: {
    actions: number;
    pages: number;
    scrolls: number;
    screenshots: number;
    reasoningCalls: number;
  };
  lastSnapshot: PageSnapshot | null;
}

/** Joins several matches when an extraction field sets `all: true`. */
export const EXTRACT_ALL_SEPARATOR = "\u001E";

export interface ExtractionSchema {
  /**
   * `all` returns every match joined by EXTRACT_ALL_SEPARATOR (adapters that
   * cannot do this return the first match). `maxChars` raises the per-field cap
   * for large structured payloads such as JSON-LD lists.
   */
  fields: Record<string, { selector: string; attribute?: string | null; all?: boolean; maxChars?: number }>;
}

export interface ExtractionResult {
  values: Record<string, string | null>;
  sourceUrl: string;
  observedAt: string;
  errors: string[];
}

export type WaitCondition = {
  selector?: string;
  text?: string;
  urlIncludes?: string;
  timeoutMs?: number;
};

export interface AgentBrowser {
  createSession(options?: {
    id?: string;
    visible?: boolean;
    screenshotDirectory?: string;
    limits?: Partial<BrowserSession["limits"]>;
  }): Promise<BrowserSession>;
  navigate(session: BrowserSession, url: string): Promise<BrowserObservation>;
  search(session: BrowserSession, query: string): Promise<BrowserObservation>;
  observe(session: BrowserSession): Promise<PageSnapshot>;
  click(session: BrowserSession, ref: string): Promise<BrowserObservation>;
  type(session: BrowserSession, ref: string, text: string): Promise<BrowserObservation>;
  select(session: BrowserSession, ref: string, value: string): Promise<BrowserObservation>;
  scroll(session: BrowserSession, target: string | null, direction: "up" | "down" | "left" | "right"): Promise<BrowserObservation>;
  waitFor(session: BrowserSession, condition: WaitCondition): Promise<BrowserObservation>;
  extract(session: BrowserSession, schema: ExtractionSchema): Promise<ExtractionResult>;
  extractLinks?(session: BrowserSession, selector: string, timeoutMs?: number): Promise<PageSnapshot["links"]>;
  /** Structured, ref-based actions (worker runtime). No generic script evaluation. */
  key?(session: BrowserSession, key: string): Promise<BrowserObservation>;
  back?(session: BrowserSession): Promise<BrowserObservation>;
  forward?(session: BrowserSession): Promise<BrowserObservation>;
  screenshot(session: BrowserSession): Promise<string>;
  /**
   * `outcome` says why the run ended: a completed run (including one that
   * stopped at its time budget with results) may keep a retaining runtime's
   * browser open for viewing; a cancelled run never does.
   */
  close(session: BrowserSession, outcome?: BrowserCloseOutcome): Promise<void>;
}

export type BrowserCloseOutcome = "completed" | "cancelled";
