// Friendly names for the descriptive labels in existing recordings. Keep the
// original scene labels available to voice commands, artwork and saved rooms.
const names: Record<string, string> = {
  'rain on window': 'Rain window',
  'gentle fan': 'Fan',
  'distant birds': 'Birds',
  'rain-streaked cafe window': 'Café window',
  'chrome espresso machine': 'Espresso machine',
  'porcelain cup and saucer': 'Cup and saucer',
  'gentle ocean surf': 'Ocean surf',
  'sea breeze in palm': 'Palm tree',
  'seagull on driftwood': 'Seagull',
  'rain on wet pavement puddle': 'Rain puddle',
  'hovering electric vehicle flyby': 'Electric vehicle',
  'stone water basin': 'Water basin',
  'bamboo shishi-odoshi': 'Bamboo knocker',
};

export function soundName(label: string): string {
  const name = label.trim().replace(/\s+/g, ' ');
  // Placement lives in position/wall, so it need not follow the displayed name.
  const direct = name.replace(/\s*[,;:(—–-]?\s+\b(?:on|at|near|by|along|against|beside|mounted on|attached to)\s+(?:the\s+)?(?:(?:north|south|east|west|northern|southern|eastern|western|back|front|left|right)(?:[- ](?:facing|hand))?\s+)?(?:wall|floor|ceiling)\b.*$/i, '').trim();
  const result = direct || name;
  const key = result.toLowerCase();
  return Object.hasOwn(names, key) ? names[key] : result;
}
