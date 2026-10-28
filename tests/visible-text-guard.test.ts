/**
 * THE VISIBLE-TEXT GUARD (fork, 2026-10-28; upstream #281): a teaching
 * question with nothing visible before it is blocked once, so the model
 * writes its explanation or hint and re-asks in the same turn. Offline:
 * scripted models only, closed network, scratch data — the same isolation
 * as send-to-user.test.ts.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import {
	createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall,
	type FauxResponseStep,
} from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-visible-text-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_VISIBLE_TEXT_GUARD: "1",
	LH_DATA_DIR: path.join(scratch, "data"),
	LH_AUTH_FILE: path.join(scratch, "auth.json"),
	HOME: path.join(scratch, "home"),
};
globalThis.fetch = async () => { throw new Error("CLOSED: unexpected network request"); };
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const { createTeacherAgent, createProberAgent } = await import("../src/agent/teacher-agent.ts");
const { checkVisibleText, VISIBLE_TEXT_GUARD_MARK } = await import("../src/agent/visible-text-guard.ts");
const { SEND_TO_USER_TOOL } = await import("../src/core/native-messages.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");

function scripted(steps: FauxResponseStep[]) {
	const faux = createFauxCore({ provider: "anthropic", models: [{ id: "claude-sonnet-5-5" }] });
	faux.setResponses(steps);
	const engine: PiEngine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return { engine, faux };
}

const quiz = {
	type: "check", nodeId: "synthetic", question: "What is two plus two?",
	options: [{ label: "Four", value: "4" }, { label: "Five", value: "5" }],
	correctAnswer: "4", explanation: "Add two pairs.",
};
const ask = (id: string) => fauxToolCall("quiz", quiz, { id });
const guardErrors = (messages: readonly unknown[]) =>
	messages.filter((m) => {
		const r = m as { role?: string; isError?: boolean; content?: Array<{ text?: string }> };
		return r.role === "toolResult" && r.isError && r.content?.some((b) => b.text?.startsWith(VISIBLE_TEXT_GUARD_MARK));
	});

describe("the visible-text guard (offline)", () => {
	it("blocks a check with only thinking before it; the model writes the text and re-asks in the same turn", async () => {
		const { engine, faux } = scripted([
			fauxAssistantMessage([fauxThinking("The hint lives only in here."), fauxThinking("Summarized reply."), ask("q1")], { stopReason: "toolUse" }),
			(context) => {
				assert.equal(guardErrors(context.messages).length, 1, "the model reads why it was blocked");
				return fauxAssistantMessage([fauxText("**Hint:** fix one pair first."), ask("q2")], { stopReason: "toolUse" });
			},
		]);
		const agent = createTeacherAgent(undefined, { engine });
		await agent.prompt("Hint please.");
		assert.equal(faux.state.callCount, 2);
		const last = agent.state.messages.at(-1) as { role: string; toolName?: string; isError?: boolean };
		assert.equal(last.role, "toolResult");
		assert.equal(last.toolName, "quiz");
		assert.ok(!last.isError, "the re-asked check is posed");
	});

	it("never loops: a second empty attempt goes through", async () => {
		const { engine, faux } = scripted([
			fauxAssistantMessage([fauxThinking("Nothing visible."), ask("q1")], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxThinking("Still nothing visible."), ask("q2")], { stopReason: "toolUse" }),
		]);
		const agent = createTeacherAgent(undefined, { engine });
		await agent.prompt("Go on.");
		assert.equal(faux.state.callCount, 2);
		assert.equal(guardErrors(agent.state.messages).length, 1);
	});

	for (const [label, before] of [
		["response text", fauxText("Here is the idea.")],
		["send_to_user", { type: "toolCall" as const, id: "send-1", name: SEND_TO_USER_TOOL, arguments: { message: "Here is the idea." } }],
	] as const) {
		it(`lets a check through when ${label} comes first`, async () => {
			const { engine, faux } = scripted([fauxAssistantMessage([fauxThinking("Plan."), before, ask("q1")], { stopReason: "toolUse" })]);
			const agent = createTeacherAgent(undefined, { engine });
			await agent.prompt("Teach me.");
			assert.equal(faux.state.callCount, 1);
			assert.equal(guardErrors(agent.state.messages).length, 0);
		});
	}

	it("leaves the prober alone: probe questions come without teaching", async () => {
		const chatId = chatStore.createChat("Probe").id;
		const { engine, faux } = scripted([
			fauxAssistantMessage([fauxThinking("Probing."), fauxToolCall("probe", { question: "Q?", options: quiz.options, correctAnswer: "4", explanation: "x" }, { id: "p1" })], { stopReason: "toolUse" }),
		]);
		const agent = createProberAgent({ chatId, chatStore, jobStore, deliver: () => {}, spawn: () => {} }, { engine });
		await agent.prompt("Probe me.");
		assert.equal(faux.state.callCount, 1);
		assert.equal(guardErrors(agent.state.messages).length, 0);
	});

	it("text from before his last input doesn't count", () => {
		const call = { type: "toolCall", id: "q1", name: "quiz", arguments: quiz };
		const assistantMessage = { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, call] };
		const verdict = checkVisibleText({
			toolCall: call as never,
			assistantMessage: assistantMessage as never,
			context: {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "Old explanation." }, { type: "toolCall", id: "q0", name: "quiz" }] },
					{ role: "toolResult", toolName: "quiz", toolCallId: "q0", isError: false, content: [] },
					assistantMessage,
				] as never,
			},
		});
		assert.equal(verdict?.block, true);
		assert.equal(checkVisibleText({ toolCall: { ...call, name: "ask_user_question" } as never, assistantMessage: assistantMessage as never, context: { messages: [] } }), undefined, "only teaching questions are guarded");
	});
});

describe("the visible-text guard switch", () => {
	it("is off unless LH_VISIBLE_TEXT_GUARD=1", async () => {
		const { visibleTextGuard } = await import("../src/agent/visible-text-guard.ts");
		const call = { type: "toolCall", id: "q1", name: "quiz", arguments: quiz };
		const ctx = { toolCall: call, assistantMessage: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, call] }, args: quiz, context: { messages: [] } } as never;
		assert.equal((await visibleTextGuard(ctx))?.block, true);
		process.env.LH_VISIBLE_TEXT_GUARD = "0";
		try {
			assert.equal(await visibleTextGuard(ctx), undefined);
		} finally {
			process.env.LH_VISIBLE_TEXT_GUARD = "1";
		}
	});
});
