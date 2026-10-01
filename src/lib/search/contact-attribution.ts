/**
 * Which harvested contacts may be attached to a lead.
 *
 * A first-party site lists many addresses: other employees, legal/privacy
 * mailboxes, careers inboxes. Attaching the first one found to a lead
 * misattributes contact data. Rules:
 * - person: only an address whose local part names that person; never a
 *   site phone (a company switchboard is not the person's number).
 * - business/company/other: the first public inbox, excluding functional
 *   mailboxes nobody would use for outreach.
 */
type Subject = { kind: string; title?: string | null };

const NON_OUTREACH = /^(?:privacy|legal|gdpr|dpo|dmca|abuse|security|compliance|no-?reply|donotreply|do-not-reply|unsubscribe|postmaster|webmaster|hostmaster|mailer-daemon|jobs?|careers?|recruit(?:ing|ment)?|hiring|talent|hr|press|media|billing|invoices?|accounts?-?payable|ap)$/i;

const ascii = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function nameTokens(title: string): { first: string; last: string } | null {
  const parts = ascii(title.split(/[—|@(]/)[0] ?? "").split(/[^a-z]+/).filter((part) => part.length >= 2);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

function namesPerson(local: string, title: string): boolean {
  const name = nameTokens(title);
  if (!name) return false;
  const l = ascii(local).replace(/[^a-z]/g, "");
  const { first, last } = name;
  return l.includes(first) && l.includes(last) ||
    l === first ||
    l === last ||
    l === `${first[0]}${last}` ||
    l === `${first}${last[0]}` ||
    l === `${last}${first[0]}`;
}

export function attributableEmail(subject: Subject, emails: Array<string | null | undefined>): string | null {
  for (const raw of emails) {
    const email = raw?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) continue;
    const local = email.split("@")[0]!;
    if (subject.kind === "person") {
      if (subject.title && namesPerson(local, subject.title)) return email;
      continue;
    }
    if (!NON_OUTREACH.test(local)) return email;
  }
  return null;
}

export function attributablePhone(subject: Subject, phones: Array<string | null | undefined>): string | null {
  if (subject.kind === "person") return null;
  return phones.map((phone) => phone?.trim()).find((phone): phone is string => !!phone) ?? null;
}
