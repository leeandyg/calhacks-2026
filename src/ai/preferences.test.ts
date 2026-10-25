import { describe, expect, it } from 'vitest';
import { commandContext, isTaskRecall, taskPlacePreference } from './preferences.js';

describe('task and place memory intent', () => {
  it.each(['I am going to code, bring me to the river.', 'I’m going to code bring me to the river'])('learns the requested coding association: %s', prompt => {
    expect(taskPlacePreference(prompt)).toMatchObject({ task: 'coding', place: 'river', timeBucket: 'any' });
    expect(commandContext(prompt, '', 'night').task).toBe('coding');
    expect(isTaskRecall(prompt)).toBe(false);
  });
  it('keeps explicit and manually selected time preferences', () => {
    expect(taskPlacePreference('I am going to code this morning, bring me to the river', 'any')?.timeBucket).toBe('morning');
    expect(taskPlacePreference('I am going to read, take me to a forest', 'evening')).toMatchObject({ task: 'reading', timeBucket: 'evening' });
  });
  it('recalls a task start without turning unrelated edits into replacements', () => {
    expect(isTaskRecall('I am going to code.')).toBe(true);
    expect(isTaskRecall('I’m reading this evening')).toBe(true);
    expect(isTaskRecall('I am going to code, make it rainier')).toBe(false);
    expect(taskPlacePreference('Make the river quieter while coding')).toBeUndefined();
    expect(taskPlacePreference('Bring me to the river')).toBeUndefined();
    expect(taskPlacePreference('I am going to code, bring me to the river without saving')).toBeUndefined();
    expect(taskPlacePreference('Do not remember this: I am going to code, bring me to the river')).toBeUndefined();
  });
});
