/**
 * THE HINT BUTTON (fork feature, 2026-10-28): src/core/hint.ts and its
 * hooks. Pins: Hint shows only while teaching and only on graded kinds; a
 * hint request is never graded; the model sees only the flag and his
 * thinking; the session markdown (what the extractor reads) records it as
 * a request, never a miss; and the teacher's prompt carries the hint
 * doctrine while the prober's does not.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRequestHint, compactAnswerForModel, hintRequestAnswer, newAnswerResult, sessionMarkdown } from "../src/core/index.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

const qd = {
	kind: "quiz" as const,
	question: "What is $P(\\text{rigged} \\mid HH)$?",
	questionType: "check" as const,
	options: [
		{ label: "0.31", value: "a" },
		{ label: "0.10", value: "b" },
	],
};

describe("the Hint button", () => {
	it("shows only while teaching, and only on graded questions", () => {
		assert.equal(canRequestHint("quiz", "teach"), true);
		assert.equal(canRequestHint("explain", "teach"), true);
		assert.equal(canRequestHint("ask", "teach"), false, "no right answer, nothing to hint toward");
		assert.equal(canRequestHint("quiz", "probe"), false, "a hint would blur the probe's measurement");
		assert.equal(canRequestHint("quiz", "plan"), false);
	});

	it("a hint request is never graded, and carries his thinking", () => {
		const answer = hintRequestAnswer(qd, "quiz", "  I think I need P(HH | fair) first  ");
		assert.equal(answer.hintRequested, true);
		assert.equal(answer.correct, undefined, "no verdict, so nothing counts it as a miss");
		assert.equal(answer.dontKnow, false);
		assert.deepEqual(answer.answers, []);
		assert.equal(answer.thinking, "I think I need P(HH | fair) first");
		assert.deepEqual(answer.options, [
			{ index: 1, label: "0.31" },
			{ index: 2, label: "0.10" },
		]);
		assert.equal(hintRequestAnswer(qd, "quiz", "   ").thinking, undefined, "blank thinking is dropped");
	});

	it("the model sees only the flag and the thinking", () => {
		assert.deepEqual(compactAnswerForModel(hintRequestAnswer(qd, "quiz", "stuck on the denominator")), {
			kind: "quiz",
			hintRequested: true,
			thinking: "stuck on the denominator",
		});
		assert.deepEqual(compactAnswerForModel(hintRequestAnswer(qd, "quiz")), { kind: "quiz", hintRequested: true });
	});

	it("the session markdown records a request, not a miss", () => {
		const call: LhMessage = {
			id: "a1",
			role: "assistant",
			content: [{ type: "toolCall", id: "call_1", name: "quiz", arguments: { question: qd.question } }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "toolUse",
			timestamp: 0,
		} as LhMessage;
		const md = sessionMarkdown([call, newAnswerResult("call_1", "quiz", hintRequestAnswer(qd, "quiz"))]);
		assert.ok(md.includes("The learner asked for a hint."), md);
		assert.ok(!md.includes("incorrectly"), "never recorded as a wrong answer");
	});

	it("the teacher's prompt carries the hint doctrine; the prober's does not", () => {
		assert.ok(composeInstructions("teacher").includes("hintRequested: true"));
		assert.ok(!composeInstructions("prober").includes("hintRequested"));
	});
});
