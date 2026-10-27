import { FUNNEL_QUESTIONS, type FunnelField } from '../config';

/** Pure reply helper (no model imports, so the engine can use it). */

export type RefinementPrompt = { nextRefinement: FunnelField | null; labels: string[] };

/** Template reply used for pagination and whenever Gemini is unavailable. */
export function templateReply(intro: string, refinement: RefinementPrompt): string {
  return refinement.nextRefinement ? `${intro} ${FUNNEL_QUESTIONS[refinement.nextRefinement]}` : intro;
}
