import { memoryRequest, type AgentContext } from './agent.js';
import { taskPlacePreference, type MemoryInfo, type TimeBucket } from './preferences.js';
import type { Scene } from '../scene/scene.js';

export type LearnedPreference = { task: string; timeBucket: TimeBucket; summary: string; notice: string; memory?: MemoryInfo };
/** Call only after the requested room has successfully reached the canonical store. */
export async function learnPreference(prompt: string, context: AgentContext | undefined, scene: Scene, signal?: AbortSignal): Promise<LearnedPreference | undefined> {
  const intention = taskPlacePreference(prompt, context?.timeBucket ?? 'auto');
  if (!intention) return;
  if (!context?.token) throw new Error('Connect to saved rooms to remember this task and environment.');
  const result = await memoryRequest(context, { action: 'remember', task: intention.task,
    timeBucket: intention.timeBucket, prompt: intention.summary, scene }, signal);
  return { ...intention, notice: [result.message, result.notice].filter(Boolean).join(' '), memory: result.memory };
}
