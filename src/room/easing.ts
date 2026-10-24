export const QUARTER_TURN = Math.PI / 2;
export const ROTATION_DURATION = 0.72;
export const normalizeTurn = (turn: number) => ((turn % 4) + 4) % 4;
export const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
export const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
