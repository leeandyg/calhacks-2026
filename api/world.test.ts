import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentSettings } from './world.js';
afterEach(() => vi.unstubAllEnvs());
describe('world runtime settings', () => {
  it('prefers the self-hosted worker without requiring managed resource IDs', () => {
    vi.stubEnv('WORLD_AGENT_URL', 'http://127.0.0.1:8787/v1');
    vi.stubEnv('WORLD_AGENT_API_KEY', 'local-private-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'cloud-private-key');
    expect(agentSettings()).toMatchObject({ baseUrl: 'http://127.0.0.1:8787/v1', apiKey: 'local-private-key' });
  });
  it('fails on incomplete self-hosted configuration instead of silently running in the cloud', () => {
    vi.stubEnv('WORLD_AGENT_URL', 'http://127.0.0.1:8787/v1');
    vi.stubEnv('WORLD_AGENT_API_KEY', '');
    expect(() => agentSettings()).toThrow(/WORLD_AGENT_API_KEY/);
  });
  it('cloud mode uses the managed agent and ignores a configured worker', () => {
    vi.stubEnv('WORLD_AGENT_URL', 'http://127.0.0.1:8787/v1');
    vi.stubEnv('WORLD_AGENT_API_KEY', 'local-private-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'cloud-private-key');
    expect(agentSettings('cloud')).toMatchObject({ apiKey: 'cloud-private-key' });
    expect(agentSettings('cloud')).not.toHaveProperty('baseUrl');
  });
  it('local mode uses the worker and ignores a configured managed key', () => {
    vi.stubEnv('WORLD_AGENT_URL', 'http://127.0.0.1:8787/v1');
    vi.stubEnv('WORLD_AGENT_API_KEY', 'local-private-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'cloud-private-key');
    expect(agentSettings('local')).toMatchObject({ baseUrl: 'http://127.0.0.1:8787/v1', apiKey: 'local-private-key' });
  });
  it('local mode errors (no cloud fallback) when the worker is not configured', () => {
    vi.stubEnv('WORLD_AGENT_URL', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'cloud-private-key');
    expect(() => agentSettings('local')).toThrow(/WORLD_AGENT_URL/);
  });
  it('cloud mode errors (no local fallback) when the managed key is missing', () => {
    vi.stubEnv('WORLD_AGENT_URL', 'http://127.0.0.1:8787/v1');
    vi.stubEnv('WORLD_AGENT_API_KEY', 'local-private-key');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(() => agentSettings('cloud')).toThrow(/ANTHROPIC_API_KEY/);
  });
});
