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
});
