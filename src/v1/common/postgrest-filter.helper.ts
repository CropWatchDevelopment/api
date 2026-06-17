/**
 * Strip characters that are structural in the PostgREST `.or(...)` filter
 * grammar so a user-supplied search term can't inject extra conditions or
 * break out of the OR group.
 *
 * Inside an `or=(...)` expression PostgREST uses `,` to separate conditions,
 * `(`/`)` to delimit the group, and `"`/`\` to quote/escape values. An
 * unescaped term such as `foo,is_admin.eq.true` (or `foo)` to close the group
 * early) would therefore alter the filter logic. None of these characters are
 * meaningful in a device name / EUI / location search, so we drop them. The
 * `%`/`_` LIKE wildcards are intentionally kept.
 *
 * Note: this is only needed for the string form `.or('col.op.value,...')`.
 * The column form `.ilike(column, pattern)` sends the value as a single
 * URL-encoded parameter and is not subject to this injection.
 */
export function sanitizeOrFilterTerm(term: string): string {
  return term.replace(/[,()\\"]/g, '');
}
