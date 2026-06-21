// A curated list of common time zones, labelled by their abbreviation (EST, PDT,
// PKT…) so a volunteer can recognise theirs. The VALUE is the IANA name the
// prayer engine needs; the label just leads with the abbreviation. '' = server zone.
export const TIMEZONES: { id: string; label: string }[] = [
  { id: '', label: 'Server default' },
  // North America
  { id: 'America/New_York', label: 'EST/EDT — Eastern (New York, Toronto)' },
  { id: 'America/Chicago', label: 'CST/CDT — Central (Chicago, Dallas)' },
  { id: 'America/Denver', label: 'MST/MDT — Mountain (Denver)' },
  { id: 'America/Phoenix', label: 'MST — Arizona (Phoenix, no DST)' },
  { id: 'America/Los_Angeles', label: 'PST/PDT — Pacific (Los Angeles)' },
  { id: 'America/Anchorage', label: 'AKST/AKDT — Alaska' },
  { id: 'Pacific/Honolulu', label: 'HST — Hawaii' },
  { id: 'America/Mexico_City', label: 'CST — Central Mexico (Mexico City)' },
  { id: 'America/Sao_Paulo', label: 'BRT — Brazil (São Paulo)' },
  // Europe / Africa
  { id: 'Europe/London', label: 'GMT/BST — UK (London)' },
  { id: 'Europe/Dublin', label: 'GMT/IST — Ireland (Dublin)' },
  { id: 'Europe/Paris', label: 'CET/CEST — Central Europe (Paris, Berlin)' },
  { id: 'Europe/Istanbul', label: 'TRT — Turkey (Istanbul)' },
  { id: 'Europe/Moscow', label: 'MSK — Moscow' },
  { id: 'Africa/Cairo', label: 'EET — Egypt (Cairo)' },
  { id: 'Africa/Lagos', label: 'WAT — West Africa (Lagos)' },
  { id: 'Africa/Johannesburg', label: 'SAST — South Africa' },
  // Middle East / Asia / Oceania
  { id: 'Asia/Dubai', label: 'GST — Gulf (Dubai, Abu Dhabi)' },
  { id: 'Asia/Riyadh', label: 'AST — Arabia (Riyadh, Makkah)' },
  { id: 'Asia/Karachi', label: 'PKT — Pakistan (Karachi)' },
  { id: 'Asia/Kolkata', label: 'IST — India (Delhi, Mumbai)' },
  { id: 'Asia/Dhaka', label: 'BST — Bangladesh (Dhaka)' },
  { id: 'Asia/Jakarta', label: 'WIB — Indonesia (Jakarta)' },
  { id: 'Asia/Kuala_Lumpur', label: 'MYT — Malaysia (Kuala Lumpur)' },
  { id: 'Asia/Singapore', label: 'SGT — Singapore' },
  { id: 'Australia/Sydney', label: 'AEST/AEDT — Eastern Australia (Sydney)' },
];

/** Options to render, always including the current value even if it's not in the
 *  curated list (so a hand-set zone is never silently lost). */
export function timezoneOptions(current: string): { id: string; label: string }[] {
  if (current && !TIMEZONES.some((t) => t.id === current)) {
    return [...TIMEZONES, { id: current, label: current }];
  }
  return TIMEZONES;
}
