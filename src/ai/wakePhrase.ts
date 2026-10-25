// Speech-to-text often hears "hey agent" as "hey agents", "hey Asian", "a gent" or just "Agent", and people
// start with filler ("okay, um, hey agent"). Accept those at the start of a turn; anything else is unaddressed.
const WAKE = /^\s*(?:(?:ok(?:ay)?|um+|uh+|so|and|alright|oh|yo)[\s,.!-]+)*(?:(?:hey|hay|hei|eh|a)[\s,.!-]*(?:agents?|ajent|asian|aging|regent|gent)|agents?)\b[\s,.:!?—–-]*/i;

/** Match an explicit activation at the start of a confirmed Cartesia turn. */
export function wakeCommand(text: string): string | undefined {
  const activation = WAKE.exec(text);
  return activation ? text.slice(activation[0].length).trim() : undefined;
}
