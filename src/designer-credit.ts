// ---------------------------------------------------------------------------
// Designer credit
//
// The site (thismagiccarddoesnotexist.com) is the *implied* designer of every
// card. It is appended silently at render time onto the card image only — it is
// never stored on the card record and never appears in the crucible/card text.
// So: we persist the bare user-supplied designer (or nothing), and `composeDesigner`
// is applied only to the throwaway copy handed to the image renderer.
// ---------------------------------------------------------------------------

export const SITE_CREDIT = "thismagiccarddoesnotexist.com";
const DESIGNER_SEPARATOR = " • ";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Trailing site credit plus any whitespace/separator before it, so stripping is
// idempotent and tolerant of legacy records that stored the composed string.
const SITE_CREDIT_SUFFIX = new RegExp("[\\s•·|/\\u2013\\u2014-]*" + escapeRegExp(SITE_CREDIT) + "\\s*$", "i");

/** The bare user-supplied designer, with any (legacy) trailing site credit
 *  removed. Returns "" when there's no user designer. */
export function stripSiteCredit(raw: string | undefined): string {
  return (raw ?? "").replace(SITE_CREDIT_SUFFIX, "").trim();
}

/** The on-card designer line: "<user> • site", or just the site when the user
 *  gave no designer. Idempotent — strips an existing site credit first so
 *  repeated composition never stacks it. Used only for rendering, never stored. */
export function composeDesigner(raw: string | undefined): string {
  const user = stripSiteCredit(raw);
  return user ? `${user}${DESIGNER_SEPARATOR}${SITE_CREDIT}` : SITE_CREDIT;
}
