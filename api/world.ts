import { z } from 'zod';
import { Scene } from '../src/scene/scene.js';
import { AgentError, ManagedAgent, type AgentSettings } from '../server/managedAgent.js';

// Only these API entry points read server secrets. Sessions use signed capability tokens;
// the browser never receives Anthropic credentials, tool transcripts or generated JavaScript.
export function agentSettings(): AgentSettings | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  return { apiKey, agentId: process.env.ANTHROPIC_AGENT_ID?.trim() || 'agent_01WGVB1ZMdiMn6AnYCBFoA6s', environmentId: process.env.ANTHROPIC_ENVIRONMENT_ID?.trim() || 'env_01RH8BZJsEg575kueEnaFAXj' };
}
export function agentError(error: unknown): Response {
  return Response.json({ error: error instanceof AgentError ? error.message : 'The managed agent could not complete this request.' }, { status: error instanceof AgentError ? error.status : 502 });
}
function client(): ManagedAgent {
  const settings = agentSettings();
  if (!settings) throw new AgentError('Set ANTHROPIC_API_KEY on the server and restart it.', 503);
  return new ManagedAgent(settings);
}
export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    const agent = client(), token = query.get('token') ?? '';
    if (query.get('action') === 'stream') return agent.stream(token);
    if (query.get('action') === 'asset') return await agent.asset(token, query.get('file') ?? '');
    return Response.json({ error: 'Unknown agent action.' }, { status: 400 });
  } catch (error) { return agentError(error); }
}
const ResultRequest = z.object({ action: z.literal('result'), token: z.string().max(3000), scene: Scene.nullable() });
export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = ResultRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'Send the agent token and original scene context.' }, { status: 400 });
    const result = await client().result(parsed.data.token, parsed.data.scene);
    return result ? Response.json(result, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ pending: true }, { status: 202, headers: { 'Retry-After': '2' } });
  } catch (error) { return agentError(error); }
}
