import { normalizeTurn, QUARTER_TURN } from './easing.js';

// The listener avatar faces into the room, away from the fixed camera, so the default view shows
// the bear's back. Indices follow a right-rotation cycle (back-right -> front-right -> front-left
// -> back-left) so manual rotation turns the bear consistently and keeps the sidebar portrait in sync.
export const BEAR_VIEWS = [
  { name: 'back-right', image: '/sprites/berkeley-bear-back-right.png' },
  { name: 'back-left', image: '/sprites/berkeley-bear-back-left.png' },
  { name: 'front-left', image: '/sprites/berkeley-bear.png' },
  { name: 'front-right', image: '/sprites/berkeley-bear-front-right.png' },
] as const;

export function bearDirection(angle: number) { return normalizeTurn(Math.round(angle / QUARTER_TURN)); }
