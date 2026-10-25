import { describe, expect, it } from 'vitest';
import { cafe } from '../scene/fixtures.js';
import { asksOnlyFor, commandContext, savedRoomFor, taskPlacePreference, type Preference } from './preferences.js';

const saved = (task: string, timeBucket: Preference['timeBucket'], updatedAt = 1): Preference =>
  ({ _id: `${task}-${timeBucket}`, task, timeBucket, timezone: 'America/Los_Angeles', summary: 'Beach', scene: cafe, updatedAt });

describe('loading a saved room without the world agent', () => {
  const coding = saved('coding', 'night');
  it('loads a saved task named on its own or as the usual setup', () => {
    for (const prompt of ['coding', "I'm coding", 'Time to code.', 'programming', 'Set up my usual coding environment.', 'Load my saved coding room'])
      expect(savedRoomFor(prompt, [coding], '', 'morning'), prompt).toBe(coding);
  });
  it('leaves new places and edits to the world agent', () => {
    for (const prompt of ['rainy cafe for coding', 'make the rain quieter while I code', 'a beach', 'Set up my usual reading environment'])
      expect(savedRoomFor(prompt, [coding], '', 'morning'), prompt).toBeUndefined();
  });
  it('matches free-form saved tasks by their words', () => {
    const essay = saved('writing my essay', 'any'), focus = saved('deep work', 'evening');
    expect(savedRoomFor('my usual essay writing setup', [essay, focus], '', 'morning')).toBe(essay);
    expect(savedRoomFor('deep work', [essay, focus], '', 'morning')).toBe(focus);
  });
  it('uses the Task field for the memory panel button', () => {
    expect(savedRoomFor('Set up my usual environment.', [coding], 'coding', 'morning')).toBe(coding);
  });
  it('prefers the current time of day, then any, then the newest', () => {
    const morning = saved('coding', 'morning'), any = saved('coding', 'any', 5), newer = saved('coding', 'evening', 9);
    expect(savedRoomFor('coding', [coding, any, morning], '', 'morning')).toBe(morning);
    expect(savedRoomFor('coding', [coding, any], '', 'morning')).toBe(any);
    expect(savedRoomFor('coding', [coding, newer], '', 'morning')).toBe(newer);
  });
});

describe('opening a saved environment by name', () => {
  it('matches a prompt that names the room and nothing else', () => {
    for (const prompt of ['cyberpunk city', 'Cyberpunk City.', 'a cyberpunk city', 'take me to the cyberpunk city', 'I want the cyberpunk city again'])
      expect(asksOnlyFor(prompt, 'Cyberpunk city'), prompt).toBe(true);
    for (const prompt of ['rainy cafe', 'Rainy café', 'the rainy cafe please'])
      expect(asksOnlyFor(prompt, 'Rainy café'), prompt).toBe(true);
    expect(asksOnlyFor('my study cave', 'My Study Cave')).toBe(true);
  });
  it('generates anything that adds to or only partly names it', () => {
    for (const prompt of ['a cyberpunk city at dawn with flying cars', 'cyberpunk', 'city', 'a sunny cafe', 'cafe'])
      expect(asksOnlyFor(prompt, prompt.includes('cafe') ? 'Rainy café' : 'Cyberpunk city'), prompt).toBe(false);
    expect(asksOnlyFor('make the rain quieter in the rainy cafe', 'Rainy café')).toBe(false);
  });
});

describe('task and place memory intent', () => {
  it.each(['I am going to code, bring me to the river.', 'I’m going to code bring me to the river'])('learns the requested coding association: %s', prompt => {
    expect(taskPlacePreference(prompt)).toMatchObject({ task: 'coding', place: 'river', timeBucket: 'any' });
    expect(commandContext(prompt, '', 'night').task).toBe('coding');
  });
  it('keeps explicit and manually selected time preferences', () => {
    expect(taskPlacePreference('I am going to code this morning, bring me to the river', 'any')?.timeBucket).toBe('morning');
    expect(taskPlacePreference('I am going to read, take me to a forest', 'evening')).toMatchObject({ task: 'reading', timeBucket: 'evening' });
  });
  it('does not learn from edits, bare places or opt-outs', () => {
    expect(taskPlacePreference('Make the river quieter while coding')).toBeUndefined();
    expect(taskPlacePreference('Bring me to the river')).toBeUndefined();
    expect(taskPlacePreference('I am going to code, bring me to the river without saving')).toBeUndefined();
    expect(taskPlacePreference('Do not remember this: I am going to code, bring me to the river')).toBeUndefined();
  });
});

describe('demo task places', () => {
  it.each(['I want to code', "I'm going to code", 'time to code', 'coding', 'programming', 'I want to read', 'I want to read now', "let's read", 'reading'])(
    'names only the task: %s', prompt => {
      expect(asksOnlyFor(prompt, 'coding') || asksOnlyFor(prompt, 'reading')).toBe(true);
    });
  it.each(['I want to code in a forest', 'read me the news', 'make the rain quieter while I code'])('asks for more: %s', prompt => {
    expect(asksOnlyFor(prompt, 'coding') || asksOnlyFor(prompt, 'reading')).toBe(false);
  });
});
