// Filled, integer-grid icons keep controls on the same visual footing as the room sprites.
const paths = {
  send: 'M7 2h2v2h2v2h2v2h-2V6H9v8H7V6H5v2H3V6h2V4h2Z',
  mic: 'M6 1h4v1h1v7h-1v1H6V9H5V2h1ZM3 7h1v3h1v1h6v-1h1V7h1v4h-1v1H9v2h3v1H4v-1h3v-2H4v-1H3Z',
  stop: 'M3 3h10v10H3Z',
  close: 'M2 2h2v2h2v2h4V4h2V2h2v2h-2v2h-2v4h2v2h2v2h-2v-2h-2v-2H6v2H4v2H2v-2h2v-2h2V6H4V4H2Z',
  sound: 'M6 2h8v9h-2V4H8v9H6v2H2v-4h4ZM10 11h2v2h-2Z',
  eye: 'M4 3h8v2h2v2h2v2h-2v2h-2v2H4v-2H2V9H0V7h2V5h2ZM4 5v2H2v2h2v2h8V9h2V7h-2V5ZM6 6h4v4H6Z',
  hidden: 'M0 1h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v-2h-2v-2h-2V9h-2V7H8V5H6V3H4V1H2V0H0ZM8 3h4v2h2v2h2v2h-2V7h-2V5H8ZM2 7h2v4h4v2H4v-2H2V9H0V7Z',
  trash: 'M4 2h8v2h3v2H1V4h3ZM3 7h2v6h6V7h2v8H3ZM6 7h1v5H6ZM9 7h1v5H9Z',
  left: 'M6 2h2v2H6v2H4v1h11v2H4v1h2v2h2v2H6v-2H4v-2H2V6h2V4h2Z',
  right: 'M8 2h2v2h2v2h2v4h-2v2h-2v2H8v-2h2v-2h2V9H1V7h11V6h-2V4H8Z',
} as const;

export function PixelIcon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
    <path d={paths[name]} fillRule="evenodd"/>
  </svg>;
}
