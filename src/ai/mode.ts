export type AgentMode = 'local' | 'cloud';

// Which world agent the browser talks to, read once from the URL like DEMO_MODE (?demo).
// ?mode=local routes to the self-hosted worker container; anything else uses the cloud managed agent.
// There is no UI control: the mode is entirely URL-driven and rides on every /api/scene and /api/world call.
export const AGENT_MODE: AgentMode =
  new URLSearchParams(window.location.search).get('mode') === 'local' ? 'local' : 'cloud';
