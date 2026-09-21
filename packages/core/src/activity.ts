/** Render a human sentence from a structured activity entry (used by API and client). */
export function formatActivity(entry: { actorName: string; verb: string; objectType: string; objectLabel: string; diff?: Record<string, { from: unknown; to: unknown }> | null }): string {
  const object = entry.objectType.replace(/_/g, ' ');
  const label = entry.objectLabel ? ` ${entry.objectLabel}` : '';
  const base = `${entry.actorName} ${entry.verb.replace(/_/g, ' ')} ${object}${label}`;
  if (entry.diff && Object.keys(entry.diff).length === 1) {
    const [field, change] = Object.entries(entry.diff)[0]!;
    if (change.from !== undefined && change.to !== undefined && typeof change.from !== 'object' && typeof change.to !== 'object') {
      return `${base} (${field.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${String(change.from)} → ${String(change.to)})`;
    }
  }
  return base;
}
