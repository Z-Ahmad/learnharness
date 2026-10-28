/**
 * Hint requests (fork feature, 2026-10-28): the question dock's Hint button
 * answers the pending question with a REQUEST, not an answer — the teacher
 * gives one nudge and poses the same question again
 * (src/agent/prompts/teacher/35-hints.md). It rides the ordinary answer
 * path, like a dismissal, so the turn machinery needs nothing new.
 *
 * Never graded: no selection, no `correct`, so nothing downstream counts it
 * as a miss. The learner's thinking so far rides along to aim the hint.
 */

import type { QuestionAnswerData, QuestionData } from "./question-core.ts";
import type { Phase3 } from "./phases.ts";

/** Question kinds a hint makes sense for: graded ones (multiple choice, free recall). */
const HINTABLE = new Set(["quiz", "explain"]);

/** The dock shows Hint only while teaching: in the probe a hint would
 *  blur the measurement the probe exists to take. */
export function canRequestHint(kind: string, phase: Phase3): boolean {
	return phase === "teach" && HINTABLE.has(kind);
}

/** The answer record for a hint request. */
export function hintRequestAnswer(
	qd: Pick<QuestionData, "kind" | "question" | "questionType" | "options">,
	tool: string | undefined,
	thinking?: string,
): QuestionAnswerData {
	return {
		kind: qd.kind,
		...(tool ? { tool } : {}),
		questionType: qd.questionType,
		questionText: qd.question,
		options: qd.options.map((o, i) => ({ index: i + 1, label: o.label })),
		dontKnow: false,
		answers: [],
		thinking: thinking?.trim() || undefined,
		hintRequested: true,
		answeredAt: new Date().toISOString(),
	};
}
