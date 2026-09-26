/** Normalized job posting. */
export type JobSourceKind =
  | "source-ats-greenhouse"
  | "source-ats-lever"
  | "source-ats-ashby"
  | "source-ats-smartrecruiters"
  | "source-ats-workable"
  | "source-ats-recruitee"
  | "source-ats-workday"
  | "source-remoteok"
  | "source-remotive"
  | "source-jobicy"
  | "source-weworkremotely"
  | "source-arbeitnow"
  | "source-workingnomads"
  | "source-usajobs"
  | "source-themuse"
  | "source-githubjobs"
  | "source-hn"
  | "source-workatastartup"
  | "source-himalayas"
  | "source-internshala"
  | "source-4dayweek"
  | "source-nodesk"
  | "source-freehire";

export type JobRegion = "any" | "remote" | "north_america" | "europe" | "asia" | "middle_east";

export type JobSourceId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "recruitee"
  | "workday"
  | "remoteok"
  | "remotive"
  | "jobicy"
  | "weworkremotely"
  | "arbeitnow"
  | "workingnomads"
  | "usajobs"
  | "themuse"
  | "githubjobs"
  | "hn"
  | "workatastartup"
  | "himalayas"
  | "internshala"
  | "4dayweek"
  | "nodesk"
  | "freehire";

export const ALL_JOB_SOURCE_IDS: JobSourceId[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "recruitee",
  "workday",
  "remoteok",
  "remotive",
  "jobicy",
  "weworkremotely",
  "arbeitnow",
  "workingnomads",
  "usajobs",
  "themuse",
  "githubjobs",
  "hn",
  "workatastartup",
  "himalayas",
  "internshala",
  "4dayweek",
  "nodesk",
  "freehire",
];

export type JobSearchFilters = {
  query?: string;
  location?: string;
  remoteOnly?: boolean;
  seniority?: string;
  /** full-time | contract | part-time | internship | any (free text normalized). */
  employmentType?: string;
  region?: JobRegion;
  sources?: JobSourceId[];
  limit?: number;
  contactRoles?: string[];
};

export type JobPosting = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  source: JobSourceKind;
  board_id: string;
  posted_at: string | null;
  updated_at?: string | null;
  /** When this record was fetched (provenance timestamp). */
  fetched_at: string;
  description: string | null;
  salary: string | null;
  remote: boolean;
  seniority: string | null;
  department?: string | null;
  employment_type?: string | null;
  company_domain?: string | null;
  contacts?: Array<{ name?: string; title?: string; email?: string }>;
};

export type RawJobPosting = {
  title: string;
  company: string;
  location?: string | null;
  url: string;
  source: JobSourceKind;
  board_id: string;
  posted_at?: string | null;
  updated_at?: string | null;
  description?: string | null;
  salary?: string | null;
  remote?: boolean;
  seniority?: string | null;
  department?: string | null;
  employment_type?: string | null;
};
