import { describe, expect, it } from 'vitest';
import { wakeCommand } from './wakePhrase.js';

describe('explicit voice activation', () => {
  it.each(['make it rainier', 'I said hey agent yesterday', 'they want the fan quieter', 'hey agency'])('ignores speech without a leading wake phrase: %s', text => {
    expect(wakeCommand(text)).toBeUndefined();
  });
  it('keeps a command in the same sentence, including its punctuation', () => {
    expect(wakeCommand('Hey, AGENT: make the rain quieter.')).toBe('make the rain quieter.');
  });
  it('distinguishes activation alone from unaddressed speech', () => {
    expect(wakeCommand(' Hey agent! ')).toBe('');
    expect(wakeCommand('hello')).toBeUndefined();
  });
  it.each([
    ['Hey agents, mute the rain', 'mute the rain'], ['Okay, um, hey agent. Make it rainier.', 'Make it rainier.'],
    ['Hey Asian, turn the fan down', 'turn the fan down'], ['Hey aging mute rain', 'mute rain'],
    ['Agent, add a fireplace', 'add a fireplace'], ['A gent, mute the birds', 'mute the birds'], ['Hay agent!', ''],
  ])('accepts common transcriptions of the wake phrase: %s', (text, command) => {
    expect(wakeCommand(text)).toBe(command);
  });
  it.each(['a gentle breeze please', 'agency work', 'Asian food is great'])('still ignores lookalikes: %s', text => {
    expect(wakeCommand(text)).toBeUndefined();
  });
});
