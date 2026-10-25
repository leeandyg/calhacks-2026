import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { environmentTheme } from './environmentTheme.js';

const luminance = (hex: string) => [1, 3, 5].map(offset => {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (foreground: string, background: string) => (luminance(foreground) + .05) / (luminance(background) + .05);

describe('environment UI palette', () => {
  it('keeps CSS grey defaults without usable art colors', () => {
    expect(environmentTheme()).toEqual({});
    expect(environmentTheme('url(unsafe)', ['not-a-color'])).toEqual({});
  });
  for (const id of ['cafe', 'beach', 'cyberpunk', 'zen']) {
    it(`keeps text readable against the ${id} palette`, () => {
      const { environment } = JSON.parse(readFileSync(new URL(`../../public/demo/${id}/assets.json`, import.meta.url), 'utf8'));
      const theme = environmentTheme(environment.shell, environment.colors);
      expect(Object.values(theme).every(color => /^#[\da-f]{6}$/i.test(color))).toBe(true);
      for (const surface of ['--ui-bg', '--ui-panel', '--ui-inset'] as const)
        expect(contrast('#b6c0d0', theme[surface]!)).toBeGreaterThanOrEqual(4.5);
      for (const surface of ['--ui-button', '--ui-hover', '--ui-primary', '--ui-selected'] as const)
        expect(contrast('#e8e8f0', theme[surface]!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
