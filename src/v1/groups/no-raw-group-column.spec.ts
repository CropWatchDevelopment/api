import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Tripwire: since 038 a device's or location's group is `group_id` → a row in
 * cw_device_groups / cw_location_groups, and 039 drops the old free-text
 * `group` columns. Only src/v1/groups/ (group-columns.ts) may know how a
 * group is read; a query elsewhere that still names the text column would
 * return stale data until 039 and fail after it. This test fails the build
 * if one appears.
 *
 * Payloads are covered twice: an inline .insert/.update/.upsert({ … }) with a
 * `group` key fails here, and a payload typed TableInsert/TableUpdate<…> does
 * not build (database.types.ts has no `group` on cw_devices / cw_locations).
 * The Supabase client itself is untyped, so keep payloads typed.
 */
const SRC_ROOT = join(__dirname, '..', '..');
const ALLOWED_DIR = join('v1', 'groups');

/** A filter call on the text column: .eq('group', …), .ilike('cw_locations.group', …). */
const FILTER_CALL_ON_GROUP =
  /\.(?:eq|neq|gt|gte|lt|lte|ilike|like|is|in|not|order|contains|containedBy|filter|textSearch|likeAnyOf|likeAllOf|ilikeAnyOf|ilikeAllOf|select)\(\s*['"`](?:[a-z_]+\.)?"?group"?['"`]/;
/** Every string literal (quotes and template literals, which may span lines). */
const STRING_LITERAL =
  /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
/** A PostgREST filter expression on the column, as in .or('group.ilike.%x%'). */
const FILTER_EXPRESSION =
  /(?:^|[\s,(])(?:[a-z_]+\.)?"?group"?\.(?:eq|neq|ilike|like|is|in|not|gt|gte|lt|lte)\./;
/** Literals made only of identifiers, quotes, commas, parens, `:`, `!`, `*` and `.`: column lists. */
const COLUMN_LIST = /^[\s\w:!*,()".]*$/;

/** True when a string literal names the text column. */
function literalUsesGroupColumn(literal: string): boolean {
  const content = literal.slice(1, -1).replace(/\$\{[^}]*\}/g, ' ');
  if (FILTER_EXPRESSION.test(content)) {
    return true;
  }
  // Column lists separate names with commas or parens; prose has words
  // separated by spaces only ("The location group, if any.").
  if (
    !COLUMN_LIST.test(content) ||
    !/[,(]/.test(content) ||
    /\w\s+\w/.test(content)
  ) {
    return false;
  }
  return content
    .split(/[\s,()]+/)
    .some((token) => token === 'group' || token === '"group"');
}

/** A `group` key (or shorthand) in an object literal: `{ name, group }`, `group: x`, `['group']: x`. */
const GROUP_KEY =
  /(?:^|[\s,{])(?:["']?group["']?|\[\s*["'`]group["'`]\s*\])\s*(?::|,|\})/;

/** The object literals passed straight to .insert(…), .update(…), .upsert(…) and .match(…). */
function payloadLiterals(source: string): string[] {
  const payloads: string[] = [];
  for (const call of source.matchAll(
    /\.(?:insert|update|upsert|match)\(\s*\{/g,
  )) {
    const start = (call.index ?? 0) + call[0].length - 1;
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) {
        payloads.push(source.slice(start, i + 1));
        break;
      }
    }
  }
  return payloads;
}

function usesGroupColumn(source: string): boolean {
  if (FILTER_CALL_ON_GROUP.test(source)) {
    return true;
  }
  if (payloadLiterals(source).some((payload) => GROUP_KEY.test(payload))) {
    return true;
  }
  return [...source.matchAll(STRING_LITERAL)].some(([literal]) =>
    literalUsesGroupColumn(literal),
  );
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === 'node_modules' || entry === '__snapshots__') continue;
      collectSourceFiles(full, out);
    } else if (
      /\.(ts|js)$/.test(entry) &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('the old group text column stays out of queries', () => {
  it('recognises the ways the text column could be queried', () => {
    for (const sample of [
      `query.ilike('group', '%x%')`,
      `query.not('group', 'is', null)`,
      `query.eq('cw_locations.group', name)`,
      `query.filter('group', 'eq', name)`,
      `query.or('group.ilike.%x%,name.ilike.%x%')`,
      `query.or(\`name.ilike.%\${q}%,cw_locations.group.eq.\${g}\`)`,
      `client.from('cw_locations').select(\`\${EMBED}, group\`)`,
      `client.from('cw_devices').select('dev_eui, name, group, location_id')`,
      `const COLUMNS = \`dev_eui, name, "group",
         cw_locations(location_id, name, "group")\`;`,
      `const LOCATION = 'cw_locations!inner(location_id, name, group)';`,
      `client.from('cw_devices').insert({ dev_eui, name, group: dto.group })`,
      `client.from('cw_devices').update({ name, group, location_id }).eq('dev_eui', x)`,
      `client.from('cw_locations').upsert({\n  name,\n  "group": g,\n})`,
      `client.from('cw_devices').select('group')`,
      `client.from('cw_devices').select("group")`,
      `query.match({ group: name })`,
      `query.gt('group', 'a')`,
      `query.textSearch('group', 'barn')`,
      `query.ilikeAnyOf('group', ['%a%'])`,
      `client.from('cw_devices').update({ ['group']: name })`,
    ]) {
      expect({ sample, flagged: usesGroupColumn(sample) }).toEqual({
        sample,
        flagged: true,
      });
    }
    for (const sample of [
      `query.ilike('device_group.name', '%x%')`,
      `query.not('group_id', 'is', null)`,
      `client.from('cw_locations').select(\`*, location_group:cw_location_groups(name)\`)`,
      `@Query('group') searchGroup?: string`,
      `@ApiQuery({ name: 'group', required: false })`,
      `client.from('cw_devices').update({ name, group_id: 3, location_id })`,
      `client.from('cw_devices').insert({ meta: { group_id: 1 }, name })`,
      `description: 'Filter by device group (case-insensitive contains).'`,
      `message: 'The location group, if any.'`,
      `description: 'Name of the location group (cw_location_groups), or null.'`,
    ]) {
      expect({ sample, flagged: usesGroupColumn(sample) }).toEqual({
        sample,
        flagged: false,
      });
    }
  });

  it('no file outside src/v1/groups queries the group text column', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) => !relative(SRC_ROOT, file).startsWith(ALLOWED_DIR + sep))
      .filter((file) => usesGroupColumn(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
