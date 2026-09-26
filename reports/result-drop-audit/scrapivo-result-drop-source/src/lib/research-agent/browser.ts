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

export interface ExtractionSchema {
  fields: Record<string, { selector: string; attribute?: string | null }>;
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
  screenshot(session: BrowserSession): Promise<string>;
  close(session: BrowserSession): Promise<void>;
}
