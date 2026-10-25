import { useLayoutEffect, useMemo } from 'react';
import { useArtStore } from '../art/store.js';
import { useSceneStore } from '../scene/store.js';
import { ROOM_THEMES } from '../room/roomConfig.js';

const themeKeys = ['--ui-bg', '--ui-panel', '--ui-inset', '--ui-button', '--ui-hover', '--ui-edge', '--ui-shadow', '--ui-accent', '--ui-primary', '--ui-primary-shadow', '--ui-selected'] as const;
type Theme = Partial<Record<typeof themeKeys[number], string>>;
type RGB = [number, number, number];
const rgb = (color: string): RGB => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as RGB;
const hex = (color: RGB) => `#${color.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: RGB, b: RGB, amount: number): RGB => a.map((channel, i) => channel * (1 - amount) + b[i] * amount) as RGB;
const validColor = (color: string) => /^#[\da-f]{6}$/i.test(color);

/** Dark UI surfaces use the room's actual palette; bright art never makes text illegible. */
export function environmentTheme(shell?: string, colors: readonly string[] = []): Theme {
  const palette = colors.filter(validColor).map(rgb);
  const base = palette[0] ?? (shell && validColor(shell) ? rgb(shell) : undefined);
  if (!base) return {}; // Keep the existing grey CSS defaults for a fresh room.
  const scale = Math.min(1, 150 / Math.max(...base, 1));
  const tint = base.map(channel => channel * scale) as RGB;
  const accent = palette.reduce((best, color) => Math.max(...color) - Math.min(...color) > Math.max(...best) - Math.min(...best) ? color : best, base);
  const surface = (neutral: string, amount: number) => hex(mix(rgb(neutral), tint, amount));
  return {
    '--ui-bg': surface('#11171e', .3),
    '--ui-panel': surface('#202936', .3),
    '--ui-inset': surface('#151d28', .25),
    '--ui-button': surface('#303d51', .3),
    '--ui-hover': surface('#3b4c64', .3),
    '--ui-edge': hex(mix(rgb('#65748d'), accent, .35)),
    '--ui-shadow': surface('#172131', .3),
    '--ui-accent': hex(mix(accent, rgb('#ffffff'), .65)),
    '--ui-primary': hex(mix(rgb('#202936'), accent, .22)),
    '--ui-primary-shadow': surface('#172131', .35),
    '--ui-selected': hex(mix(rgb('#202936'), accent, .18)),
  };
}

/** Apply the same palette to the main document and the shared floating voice portal. */
export function useEnvironmentTheme(target: HTMLElement) {
  const preset = useSceneStore(state => state.scene.room.preset);
  const envId = useSceneStore(state => state.scene.room.art);
  const env = useArtStore(state => envId ? state.envs[envId] : undefined);
  const theme = useMemo<Theme>(() => env ? environmentTheme(env.shell, env.colors)
    : preset === 'bedroom' ? {} : environmentTheme(ROOM_THEMES[preset].surface, [ROOM_THEMES[preset].accent]), [preset, env]);
  useLayoutEffect(() => {
    for (const key of themeKeys) {
      const color = theme[key];
      if (color) target.style.setProperty(key, color);
      else target.style.removeProperty(key);
    }
    return () => { for (const key of themeKeys) target.style.removeProperty(key); };
  }, [theme, target]);
}
