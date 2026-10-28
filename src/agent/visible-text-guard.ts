/**
 * The visible-text guard (fork, 2026-10-28; upstream issue #281): a
 * teaching question must not arrive with nothing for the learner to read.
 *
 * Models with adaptive thinking sometimes write the turn's message — the
 * explanation before a check, the hint before a re-ask — into a SECOND
 * thinking block, which the provider delivers only as a summary. The raw
 * stream then holds thinking, thinking, tool_use and no text at all
 * (confirmed against the Anthropic wire, 2026-10-28), so the check lands
 * with its teaching invisible. send_to_user narrows this but doesn't close
 * it: the model can skip that too.
 *
 * So, before the teacher's quiz/explain call runs: if the model has been
 * thinking since his last input but nothing visible has reached him — no
 * response text, no send_to_user — the call is blocked once with a reason the model reads and
 * acts on in the same turn. A second attempt goes through, so a model that
 * can't comply never loops. Wired as the agent's beforeToolCall (teacher
 * only; the prober's questions come without teaching by design).
 *
 * Switched on by LH_VISIBLE_TEXT_GUARD=1 (scripts/fork-desktop.sh sets it).
 * Upstream's scripted chat-flow fixtures pose thinking-plus-question turns
 * as ordinary scaffolding; an explicit switch keeps them running unchanged
 * instead of forking those tests.
 */

import type { AgentMessage, BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import { SEND_TO_USER_TOOL } from "../core/native-messages.ts";
import { QUESTION_TOOLS } from "../core/pending.ts";

/** The teaching questions this guards (the teacher's own question tools). */
const GUARDED = new Set(["quiz", "explain"]);

export const VISIBLE_TEXT_GUARD_MARK = "[visible-text guard]";

const REASON =
	`${VISIBLE_TEXT_GUARD_MARK} Not posed: nothing has reached the learner this turn. Your thinking is never shown to him, ` +
	"and ordinary response text can be swallowed into it. Deliver what he needs to read first — the explanation, " +
	"the resolution of his last answer, or the hint he asked for — with send_to_user if you have it, otherwise as " +
	"plain response text. Then make this same call again.";

type Block = { type?: string; text?: string; name?: string; id?: string };

function blocksOf(m: AgentMessage): Block[] {
	const content = (m as { content?: unknown }).content;
	return Array.isArray(content) ? (content as Block[]) : [];
}

/** Does this block put something in front of the learner? */
function isVisible(b: Block): boolean {
	return (b.type === "text" && !!b.text?.trim()) || (b.type === "toolCall" && b.name === SEND_TO_USER_TOOL);
}

/** The learner's last input ends a stretch: his message, or his answer to a question. */
function isLearnerInput(m: AgentMessage): boolean {
	const role = (m as { role?: string }).role;
	if (role === "user") return true;
	if (role !== "toolResult") return false;
	const r = m as { toolName?: string; isError?: boolean };
	return !r.isError && (QUESTION_TOOLS as readonly string[]).includes(r.toolName ?? "");
}

function isGuardBlock(m: AgentMessage): boolean {
	if ((m as { role?: string }).role !== "toolResult" || !(m as { isError?: boolean }).isError) return false;
	return blocksOf(m).some((b) => b.type === "text" && b.text?.startsWith(VISIBLE_TEXT_GUARD_MARK));
}

/** Read per call, so a test can flip it without reloading the module. */
export function visibleTextGuardEnabled(): boolean {
	return process.env.LH_VISIBLE_TEXT_GUARD === "1";
}

export function checkVisibleText(ctx: Pick<BeforeToolCallContext, "assistantMessage" | "toolCall" | "context">): BeforeToolCallResult | undefined {
	if (!GUARDED.has(ctx.toolCall.name)) return undefined;

	// Everything since his last input, then this message up to the call itself.
	const history = ctx.context.messages;
	let start = history.length;
	while (start > 0 && !isLearnerInput(history[start - 1]!)) start--;
	const stretch = history.slice(start).filter((m) => m !== ctx.assistantMessage);

	if (stretch.some(isGuardBlock)) return undefined; // already blocked once: never loop
	if (stretch.some((m) => (m as { role?: string }).role === "assistant" && blocksOf(m).some(isVisible))) return undefined;

	const own = blocksOf(ctx.assistantMessage as AgentMessage);
	const callAt = own.findIndex((b) => b.type === "toolCall" && b.id === ctx.toolCall.id);
	const before = own.slice(0, callAt < 0 ? own.length : callAt);
	if (before.some(isVisible)) return undefined;

	// The #281 signature is a message written INTO thinking. With no thinking
	// at all, a bare question is the model's choice, not a swallowed reply.
	const thought = [...stretch.filter((m) => (m as { role?: string }).role === "assistant").flatMap(blocksOf), ...before].some(
		(b) => b.type === "thinking",
	);
	if (!thought) return undefined;

	return { block: true, reason: REASON };
}

/** The agent hook (src/agent/teacher-agent.ts baseAgentOptions). */
export async function visibleTextGuard(ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> {
	return visibleTextGuardEnabled() ? checkVisibleText(ctx) : undefined;
}
