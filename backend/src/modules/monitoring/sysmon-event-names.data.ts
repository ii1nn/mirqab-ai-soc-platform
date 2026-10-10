/** The Sysmon event IDs actually useful for triage — not the full event schema (24 total). */
export const SYSMON_EVENT_NAMES: Record<number, string> = {
  1: 'Process Create',
  3: 'Network Connection',
  7: 'Image Loaded',
  8: 'CreateRemoteThread',
  10: 'Process Access',
  11: 'File Create',
  12: 'Registry Object Added/Deleted',
  13: 'Registry Value Set',
  22: 'DNS Query',
};

export function sysmonEventName(eventId: number): string {
  return SYSMON_EVENT_NAMES[eventId] ?? `Sysmon Event ID ${eventId}`;
}
