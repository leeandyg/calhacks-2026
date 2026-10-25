import { normalizeTurn, QUARTER_TURN } from './easing.js';

// The default avatar faces into the left side of the room, showing its back-left view.
// This shared visual offset keeps manual rotation and the Assets portrait in sync;
// it never changes the canonical listener orientation or spatial audio.
export const BEAR_VIEWS = [
  { name: 'back-right', image: '/sprites/berkeley-bear-back-right.png' },
  { name: 'back-left', image: '/sprites/berkeley-bear-back-left.png' },
  { name: 'front-left', image: '/sprites/berkeley-bear.png' },
  { name: 'front-right', image: '/sprites/berkeley-bear-front-right.png' },
] as const;

export function bearDirection(angle: number) { return normalizeTurn(Math.round(angle / QUARTER_TURN) + 1); }
