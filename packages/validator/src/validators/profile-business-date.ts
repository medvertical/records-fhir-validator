/** Calendar dates are compared in the policy's named zone, never the host's zone. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function profileBusinessDate(value: unknown, zone: string): string | null {
  if (typeof value !== 'string') return null;
  if (isCalendarDate(value)) return value;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !isCalendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59
    || Number(match[4]) > 59 || (match[6] && (Number(match[7]) > 14 || Number(match[8]) > 59
      || (Number(match[7]) === 14 && Number(match[8]) !== 0)))) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
