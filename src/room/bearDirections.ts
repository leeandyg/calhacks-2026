import { normalizeTurn, QUARTER_TURN } from './easing.js';

export const BEAR_VIEWS = [
  { name: 'front-left', image: '/sprites/berkeley-bear.png' },
  { name: 'front-right', image: '/sprites/berkeley-bear-front-right.png' },
  { name: 'back-right', image: '/sprites/berkeley-bear-back-right.png' },
  { name: 'back-left', image: '/sprites/berkeley-bear-back-left.png' },
] as const;

export function bearDirection(angle: number) { return normalizeTurn(Math.round(angle / QUARTER_TURN)); }
