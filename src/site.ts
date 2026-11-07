/** What the site's company search form offers (NATIVE-NOTES.md, section 3), and the paths this server reads. */

export const PATHS = {
  home: "/",
  search: "/filter/branch/results",
  industryPrompt: "/industry-classification-prompt/",
  index: "/index/",
  terms: "/terms-of-use-and-privacy-policy/",
} as const;

/** The search form's "Company Type" list: this server's name for each, the site's option value, and the label it shows. */
export const COMPANY_TYPES = {
  nz_limited: { id: "1", label: "NZ Limited Company" },
  overseas_non_asic: { id: "2", label: "Overseas Non-ASIC Company" },
  overseas_asic: { id: "3", label: "Overseas ASIC Company" },
  nz_cooperative: { id: "4", label: "NZ Co-operative Company" },
  nz_unlimited: { id: "5", label: "NZ Unlimited Company" },
  incorporated_society: { id: "15", label: "Incorporated Society" },
  limited_partnership_nz: { id: "16", label: "Limited Partnership (NZ)" },
  charitable_trust: { id: "17", label: "Charitable Trust" },
  industrial_provident_society: { id: "18", label: "Industrial & Provident Society" },
  friendly_society: { id: "19", label: "Friendly Society" },
  building_society: { id: "20", label: "Building Society" },
  credit_union: { id: "21", label: "Credit Union" },
  limited_partnership_overseas: { id: "22", label: "Limited Partnership (Overseas)" },
  special_body: { id: "26", label: "Special Body" },
} as const;
export type CompanyType = keyof typeof COMPANY_TYPES;
export const TYPE_KEYS = Object.keys(COMPANY_TYPES) as [CompanyType, ...CompanyType[]];

/** A type as the site writes it on a company page ("Limited Partnership (nz)") in the form's spelling, when it is one of them. */
export function canonicalType(label: string): string {
  const k = label.toLowerCase().replace(/\s+/g, " ").trim();
  for (const t of Object.values(COMPANY_TYPES)) if (t.label.toLowerCase() === k) return t.label;
  return label.trim();
}

/** Rows per page the search accepts; anything else is answered with 10. */
export const PAGE_SIZES = [10, 20, 50] as const;

export const companyPath = (nzbn: string): string => `/company/${nzbn}/`;
export const companyUrl = (nzbn: string): string => `https://www.bizdb.co.nz/company/${nzbn}/`;
/** The NZBN in a link to a company page ("/company/9429040089218/"), or "". */
export const nzbnOf = (href: string): string => /\/company\/(\d{13})\/?/.exec(href)?.[1] ?? "";
