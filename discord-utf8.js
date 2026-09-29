/** Repair common UTF-8→Windows-1252 (and ā€* variant) mojibake without touching valid Unicode. */

const REPLACEMENTS = [
  // Em/en dash, ellipsis, bullet, quotes (â€* and corrupted ā€*)
  ["\u0101\u20AC\u201D", "\u2014"], // ā€” → —
  ["\u00E2\u20AC\u201D", "\u2014"], // â€” → —
  ["\u0101\u20AC\u201C", "\u2013"], // ā€“ → –
  ["\u00E2\u20AC\u201C", "\u2013"], // â€“ → –
  ["\u0101\u20AC\u00A2", "\u2022"], // ā€¢ → •
  ["\u00E2\u20AC\u00A2", "\u2022"], // â€¢ → •
  ["\u0101\u20AC\u00A6", "\u2026"], // ā€¦ → …
  ["\u00E2\u20AC\u00A6", "\u2026"], // â€¦ → …
  ["\u0101\u20AC\u2122", "\u2019"], // ā€™ → ’
  ["\u00E2\u20AC\u2122", "\u2019"], // â€™ → ’
  ["\u0101\u20AC\u02DC", "\u2018"], // ā€˜ → ‘
  ["\u00E2\u20AC\u02DC", "\u2018"], // â€˜ → ‘
  ["\u0101\u20AC\u0153", "\u201C"], // ā€œ → “
  ["\u00E2\u20AC\u0153", "\u201C"], // â€œ → “
  ["\u0101\u20AC\u009D", "\u201D"], // ā€ → ”
  ["\u00E2\u20AC\u009D", "\u201D"], // â€ → ”
  // German vowels double-encoded as UTF-8-read-as-Latin1
  ["\u00C3\u00A4", "\u00E4"], // Ã¤ → ä
  ["\u00C3\u00B6", "\u00F6"], // Ã¶ → ö
  ["\u00C3\u00BC", "\u00FC"], // Ã¼ → ü
  ["\u00C3\u009F", "\u00DF"], // ÃŸ → ß
  ["\u00C3\u0084", "\u00C4"], // Ã„ → Ä
  ["\u00C3\u0096", "\u00D6"], // Ã– → Ö
  ["\u00C3\u009C", "\u00DC"], // Ãœ → Ü
  // Latvian letters double-encoded (UTF-8 bytes read as Latin-1)
  ["\u00C4\u0081", "\u0101"], // Ä + U+0081 → ā
  ["\u00C4\u008D", "\u010D"], // → č
  ["\u00C4\u0093", "\u0113"], // → ē
  ["\u00C4\u00A3", "\u0123"], // → ģ
  ["\u00C4\u00AB", "\u012B"], // → ī
  ["\u00C4\u00B7", "\u0137"], // → ķ
  ["\u00C4\u00BC", "\u013C"], // → ļ
  ["\u00C5\u0086", "\u0146"], // → ņ
  ["\u00C5\u00A1", "\u0161"], // → š
  ["\u00C5\u00AB", "\u016B"], // → ū
  ["\u00C5\u00BE", "\u017E"], // → ž
];

REPLACEMENTS.sort((a, b) => b[0].length - a[0].length);

export function repairMojibake(value) {
  let text = String(value ?? "");
  if (!text) return text;
  for (const [from, to] of REPLACEMENTS) {
    if (text.includes(from)) text = text.split(from).join(to);
  }
  return text;
}

export function repairDiscordStrings(value) {
  if (value == null) return value;
  if (typeof value === "string") return repairMojibake(value);
  if (Array.isArray(value)) return value.map(repairDiscordStrings);
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = repairDiscordStrings(child);
    return out;
  }
  return value;
}

export function hasMojibake(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return REPLACEMENTS.some(([from]) => text.includes(from));
}

export const DISCORD_JSON_CONTENT_TYPE = "application/json; charset=utf-8";
