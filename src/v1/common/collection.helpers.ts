/** Deduplicates primitive values, preserving first-seen order. */
export function uniqueValues<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Groups items into a Map keyed by the given selector. */
export function groupBy<T, TKey>(
  items: T[],
  key: (item: T) => TKey,
): Map<TKey, T[]> {
  const result = new Map<TKey, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const existing = result.get(groupKey);
    if (existing) {
      existing.push(item);
    } else {
      result.set(groupKey, [item]);
    }
  }
  return result;
}

/** The searchable shape shared by rule and report templates. */
interface SearchableTemplate {
  name: string;
  description?: string | null;
  assignments: Array<{ deviceName?: string | null; devEui: string }>;
}

/** Case-insensitive search over a template's name, description, and devices. */
export function matchesSearch(
  template: SearchableTemplate,
  search: string,
): boolean {
  const deviceText = template.assignments
    .map((assignment) => `${assignment.deviceName ?? ''} ${assignment.devEui}`)
    .join(' ');
  return [template.name, template.description ?? '', deviceText]
    .join(' ')
    .toLowerCase()
    .includes(search);
}
