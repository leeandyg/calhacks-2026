import { describe, expect, it } from 'vitest';
import { cafe } from '../scene/fixtures.js';
import { savedRoomFor, type Preference } from './preferences.js';

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
