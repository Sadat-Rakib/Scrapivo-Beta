/**
 * Scrapivo — investor render adapters.
 *
 * The merged dataset carries three record schemas (legacy individuals,
 * normalized entities, enriched firm/investor records). These adapters
 * classify each record from its own fields — `record_type` first — and
 * expose only values the source actually contains. No fabricated
 * "Angel" / "Individual" / "Verified" defaults: a badge renders only when
 * the source record supplies it, and missing fields are omitted.
 */

import type { InvestorEntity, InvestorRecord } from "./types";
import { getInvestorSectors, getInvestorStages } from "./types";
import { displayMoney, displayMoneyRange, formatUsd } from "@/lib/records/money";
import { populatedFields as walkPopulatedFields } from "@/lib/records/populated-fields";
import type { PopulatedField } from "@/lib/records/populated-fields";

export type InvestorRow = InvestorEntity | InvestorRecord;

interface LooseRow {
  id?: unknown;
  name?: unknown;
  record_type?: unknown;
  type?: unknown;
  entity_type?: unknown;
  investor_type?: unknown;
  investor_types?: unknown;
  title?: unknown;
  current_role?: unknown;
  role?: unknown;
  firm_name?: unknown;
  firm?: unknown;
  location?: unknown;
  locations?: unknown;
  firm_type?: unknown;
  lp_type?: unknown;
  focus?: unknown;
  aum?: unknown;
  founded?: unknown;
  employees?: unknown;
  website?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  linkedin?: unknown;
  target_sectors?: unknown;
  target_subsectors?: unknown;
  target_regions?: unknown;
  active_regions?: unknown;
  offices?: unknown;
  countries?: unknown;
  cities?: unknown;
  us_states?: unknown;
  asset_classes?: unknown;
  vc_investment_types?: unknown;
  profile_summary?: unknown;
  stated_investment_range?: unknown;
  source_file?: unknown;
  investment_profile?: {
    investment_range?: { raw?: unknown; min?: unknown; max?: unknown } | null;
    sweet_spot?: unknown;
    stages?: unknown;
    sectors?: unknown;
    investment_location?: unknown;
  } | null;
  links?: {
    linkedin?: unknown;
    twitter?: unknown;
    website?: unknown;
    firm?: unknown;
    profile?: unknown;
    email?: unknown;
  } | null;
  sweet_spot?: { range_min?: unknown; range_max?: unknown } | number | null;
  check_min_usd?: unknown;
  check_max_usd?: unknown;
  verification_status?: unknown;
  record_status?: unknown;
  verification?: { state?: unknown } | null;
  bio?: unknown;
  description?: unknown;
  thesis?: unknown;
  investment_thesis?: unknown;
}

const asLoose = (rec: InvestorRow): LooseRow => rec as unknown as LooseRow;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const strArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((s) => s.trim())
    : [];

const joinList = (v: unknown): string | null => {
  if (Array.isArray(v)) {
    const a = strArr(v);
    return a.length ? a.join(", ") : null;
  }
  return str(v);
};

const fmtUsd = (v: unknown): string | null => formatUsd(v);

/** Entity types that describe organizations rather than people. */
const FIRM_ENTITY_TYPES = new Set([
  "venture_capital_firm",
  "micro_vc",
  "accelerator_or_incubator",
  "angel_network",
  "investment_entity",
  "corporate_venture",
  "corporate_venture_or_investor",
  "angel_investor",
]);

/** Primary classification: the dataset's record_type wins, then legacy
 *  type/entity_type fields. Records with no classification at all are
 *  legacy person rows. */
export function isFirmRecord(rec: InvestorRow): boolean {
  const r = asLoose(rec);
  if (str(r.record_type) === "firm") return true;
  if (str(r.record_type) === "investor") return false;
  if (str(r.type) === "firm") return true;
  if (str(r.type) === "individual") return false;
  const et = str(r.entity_type);
  return et !== null && FIRM_ENTITY_TYPES.has(et);
}

const TYPE_LABELS: Record<string, string> = {
  vc: "VC",
  angel: "Angel",
  scout: "Scout",
  investor: "Investor",
  angel_investor: "Angel",
  venture_capital_firm: "VC Firm",
  micro_vc: "Micro VC",
  accelerator_or_incubator: "Accelerator",
  angel_network: "Angel Network",
  investment_entity: "Investment Entity",
  corporate_venture: "Corporate VC",
  corporate_venture_or_investor: "Corporate VC",
};

const normalizeType = (t: string): string => TYPE_LABELS[t.toLowerCase()] ?? t;

/** Type badges strictly from the source record (investor_type array first,
 *  then legacy investor_type/entity_type strings). Empty when the source
 *  carries no type information. */
export function sourceTypeBadges(rec: InvestorRow): string[] {
  const r = asLoose(rec);
  const fromArray = strArr(r.investor_type).length
    ? strArr(r.investor_type)
    : strArr(r.investor_types);
  if (fromArray.length) return fromArray.map(normalizeType);
  const single = str(r.investor_type) ?? str(r.entity_type);
  return single ? [normalizeType(single)] : [];
}

/** True only when the source record explicitly contains an "angel" type. */
export function hasExplicitAngel(rec: InvestorRow): boolean {
  const r = asLoose(rec);
  return [
    ...strArr(r.investor_type),
    ...strArr(r.investor_types),
    str(r.investor_type) ?? "",
    str(r.entity_type) ?? "",
  ].some((t) => t.toLowerCase().includes("angel"));
}

/** "Verified" only when a source field explicitly says verified;
 *  "Unverified" when a status field exists but does not; undefined when the
 *  record carries no verification data at all. */
export function verificationLabel(rec: InvestorRow): string | undefined {
  const r = asLoose(rec);
  const raw = str(r.verification_status) ?? str(r.record_status) ?? str(r.verification?.state);
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  return s.includes("verified") && !s.includes("unverified") && !s.includes("not ")
    ? "Verified"
    : "Unverified";
}

/** Stable row key: real id when present, otherwise a name slug (205 merged
 *  records ship without ids). */
export function investorRowKey(rec: InvestorRow): string {
  const r = asLoose(rec);
  const id = str(r.id);
  if (id) return id;
  const slug = str(r.name)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `name:${slug}` : "unknown";
}

/** Check size strictly from populated source fields; undefined when absent.
 *  Magnitude units (K/M/B) are preserved by the shared money module. */
export function checkSizeOf(rec: InvestorRow): string | undefined {
  const r = asLoose(rec);
  const raw = str(r.investment_profile?.investment_range?.raw);
  const min = r.investment_profile?.investment_range?.min;
  const max = r.investment_profile?.investment_range?.max;
  const fromRange = displayMoneyRange(raw, min, max);
  if (fromRange) return fromRange;
  const ss = r.sweet_spot;
  if (ss && typeof ss === "object") {
    const minS = str(ss.range_min);
    const maxS = str(ss.range_max);
    if (minS && maxS) return displayMoneyRange(`${minS} - ${maxS}`) ?? `${minS} - ${maxS}`;
  }
  const minUsd = fmtUsd(r.check_min_usd);
  const maxUsd = fmtUsd(r.check_max_usd);
  if (minUsd || maxUsd) return `${minUsd ?? "?"}–${maxUsd ?? "?"}`;
  const stated = str(r.stated_investment_range);
  if (stated) return displayMoney(stated) ?? stated;
  const sweetNum = typeof ss === "number" ? fmtUsd(ss) : fmtUsd(r.investment_profile?.sweet_spot);
  return sweetNum ? `~${sweetNum} sweet spot` : undefined;
}

export interface InvestorCardStat {
  label: string;
  value: string;
}

export type { PopulatedField };

/** Every non-null, non-empty field of the source record (shared walker).
 *  Powers the Details "Full Record" section and the dev-mode field audit,
 *  so no populated value can be silently lost. */
export function populatedFields(rec: InvestorRow): PopulatedField[] {
  return walkPopulatedFields(rec);
}

/** A human-readable link with its full destination URL preserved. */
export interface RecordLink {
  label: string;
  href: string;
}

export interface InvestorCardModel {
  key: string;
  isFirm: boolean;
  /** Single badge chip next to the name ("Firm", "VC", "Angel", …). */
  category?: string;
  /** Every type badge the source record supplies. */
  typeBadges: string[];
  subtitle?: string;
  location?: string;
  description?: string;
  /** Up to three populated stats for the card grid. */
  cardStats: InvestorCardStat[];
  /** Every populated source fact, for the Details drawer. */
  detailStats: InvestorCardStat[];
  /** Human-labeled links with their full destination URLs preserved. */
  links: RecordLink[];
  tags: string[];
  status?: string;
  checkSize?: string;
  stages: string[];
  sectors: string[];
  title?: string;
  role?: string;
  firmName?: string;
  website?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  twitter?: string;
  sourceFile?: string;
}

const stat = (label: string, value: string | null | undefined): InvestorCardStat | null =>
  value ? { label, value } : null;

/** Build a link entry only when a real URL exists. */
const link = (label: string, href: string | null | undefined): RecordLink | null => {
  const h = str(href);
  return h ? { label, href: h } : null;
};

const pickLinks = (links: (RecordLink | null)[]): RecordLink[] =>
  links.filter((l): l is RecordLink => l !== null);

const pickStats = (stats: (InvestorCardStat | null)[], max?: number): InvestorCardStat[] => {
  const filled = stats.filter((s): s is InvestorCardStat => s !== null);
  return max ? filled.slice(0, max) : filled;
};

/** Adapter for organization records (record_type === "firm" or legacy
 *  firm-typed rows). Never emits Angel/Individual badges. */
export function buildFirmCardModel(rec: InvestorRow): InvestorCardModel {
  const r = asLoose(rec);
  const key = investorRowKey(rec);
  const status = verificationLabel(rec);
  const checkSize = checkSizeOf(rec);
  const stages = getInvestorStages(rec);
  const sectors = getInvestorSectors(rec);
  const linkedin = str(r.linkedin) ?? str(r.links?.linkedin) ?? undefined;
  const website = str(r.website) ?? str(r.links?.website) ?? str(r.links?.firm) ?? undefined;
  const email = str(r.email) ?? str(r.links?.email) ?? undefined;
  const phone = str(r.phone) ?? undefined;

  const location =
    str(r.address) ??
    joinList([strArr(r.cities)[0], strArr(r.countries)[0]].filter(Boolean)) ??
    joinList(r.offices) ??
    joinList(r.active_regions) ??
    undefined;

  const detailStats = pickStats([
    stat("Type", "Firm"),
    stat("Firm type", joinList(r.firm_type)),
    stat("LP type", joinList(r.lp_type)),
    stat("Focus", joinList(r.focus)),
    stat("Check size", checkSize),
    stat("AUM", displayMoney(r.aum) ?? str(r.aum)),
    stat("Founded", str(r.founded)),
    stat("Employees", str(r.employees)),
    stat("Asset classes", joinList(r.asset_classes)),
    stat(
      "VC investment types",
      joinList(r.vc_investment_types) || (stages.length ? stages.join(", ") : null),
    ),
    stat("Target sectors", joinList(r.target_sectors)),
    stat("Target subsectors", joinList(r.target_subsectors)),
    stat("Target regions", joinList(r.target_regions)),
    stat("Active regions", joinList(r.active_regions)),
    stat("Offices", joinList(r.offices)),
    stat("Countries", joinList(r.countries)),
    stat("Cities", joinList(r.cities)),
    stat("U.S. states", joinList(r.us_states)),
    stat(
      "Stated investment range",
      displayMoney(r.stated_investment_range) ?? str(r.stated_investment_range),
    ),
    stat("Address", str(r.address)),
    stat("Email", email),
    stat("Phone", phone),
    stat("Status", status),
  ]);

  const links = pickLinks([
    link("LinkedIn profile", linkedin),
    link("Website", website),
    link("Profile", str(r.links?.profile)),
  ]);

  return {
    key,
    isFirm: true,
    category: "Firm",
    typeBadges: ["Firm"],
    subtitle: joinList(r.focus) ?? joinList(r.firm_type) ?? undefined,
    location,
    description: str(r.profile_summary) ?? undefined,
    cardStats: pickStats(
      [
        stat("Check size", checkSize),
        stat("AUM", displayMoney(r.aum) ?? str(r.aum)),
        stat("Founded", str(r.founded)),
        stat("Employees", str(r.employees)),
        stat("Firm type", joinList(r.firm_type)),
      ],
      3,
    ),
    detailStats,
    links,
    tags: [...strArr(r.focus), ...strArr(r.target_sectors), ...strArr(r.asset_classes)],
    status,
    checkSize,
    stages,
    sectors,
    firmName: str(r.name) ?? undefined,
    website,
    email,
    phone,
    linkedin,
    sourceFile: str(r.source_file) ?? undefined,
  };
}

/** Adapter for person records (record_type === "investor" and legacy
 *  individual rows). Badges come only from the source investor_type. */
export function buildIndividualCardModel(rec: InvestorRow): InvestorCardModel {
  const r = asLoose(rec);
  const key = investorRowKey(rec);
  const status = verificationLabel(rec);
  const checkSize = checkSizeOf(rec);
  const typeBadges = sourceTypeBadges(rec);
  const stages = getInvestorStages(rec);
  const sectors = getInvestorSectors(rec);
  const title = str(r.title) ?? undefined;
  const currentRole = str(r.current_role) ?? undefined;
  const firmName = str(r.firm_name) ?? str(r.firm) ?? undefined;
  const linkedin = str(r.linkedin) ?? str(r.links?.linkedin) ?? undefined;
  const twitter = str(r.links?.twitter) ?? undefined;
  const firmWebsite = str(r.links?.firm) ?? undefined;
  const website = str(r.website) ?? str(r.links?.website) ?? firmWebsite;
  const email = str(r.email) ?? str(r.links?.email) ?? undefined;

  const subtitle =
    currentRole && firmName
      ? `${currentRole} at ${firmName}`
      : (title ??
        (str(r.role) && firmName ? `${str(r.role)} · ${firmName}` : str(r.role)) ??
        undefined);

  const location =
    str(r.location) ??
    strArr(r.investment_profile?.investment_location)[0] ??
    strArr(r.locations)[0] ??
    undefined;

  const sweetSpot = fmtUsd(r.investment_profile?.sweet_spot);

  const detailStats = pickStats([
    stat("Type", typeBadges.length ? typeBadges.join(", ") : "Individual"),
    stat("Title", title),
    stat("Current role", currentRole),
    stat("Firm", firmName),
    stat("Location", location),
    stat("Check size", checkSize),
    stat("Sweet spot", sweetSpot),
    stat("Stages", stages.length ? stages.join(", ") : joinList(r.investment_profile?.stages)),
    stat("Sectors", sectors.length ? sectors.join(", ") : joinList(r.investment_profile?.sectors)),
    stat("Investment locations", joinList(r.investment_profile?.investment_location)),
    stat("Email", email),
    stat("Status", status),
  ]);

  const links = pickLinks([
    link("LinkedIn profile", linkedin),
    link("Twitter / X", twitter),
    link("Website", website && website !== firmWebsite ? website : null),
    link("Firm website", firmWebsite),
    link("Profile", str(r.links?.profile)),
  ]);

  return {
    key,
    isFirm: false,
    category: typeBadges[0] ?? "Investor",
    typeBadges,
    subtitle,
    location,
    description:
      str(r.profile_summary) ??
      str(r.bio) ??
      str(r.description) ??
      str(r.thesis) ??
      str(r.investment_thesis) ??
      undefined,
    cardStats: pickStats(
      [stat("Check size", checkSize), stat("Type", "Individual"), stat("Status", status)],
      3,
    ),
    detailStats,
    links,
    tags: sectors,
    status,
    checkSize,
    stages,
    sectors,
    title,
    role: currentRole ?? str(r.role) ?? undefined,
    firmName,
    website,
    email,
    linkedin,
    twitter,
    sourceFile: str(r.source_file) ?? undefined,
  };
}

/** Dispatch on the record's own classification. */
export function buildInvestorCardModel(rec: InvestorRow): InvestorCardModel {
  return isFirmRecord(rec) ? buildFirmCardModel(rec) : buildIndividualCardModel(rec);
}
