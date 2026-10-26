/**
 * Sketch → teacher (fork feature, 2026-10-26): when the learner sends a
 * message or answers a question, and the session's sketch snapshot changed
 * since it was last sent, the snapshot rides along as an image (plus a
 * caption carrying any typed canvas text) on that input's native append —
 * the user message, or the answer's tool result. An unchanged sketch is
 * never sent twice.
 *
 * Called by chat-handler AFTER the turn is accepted (beginTurn) and before
 * the write-ahead persist, so a refused-and-retried request can't mark a
 * snapshot as sent without it reaching the record.
 */

import crypto from "node:crypto";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { LhMessage } from "../core/native-messages.ts";
import { sketchCaption, sketchTypedText } from "../core/sketch-caption.ts";
import { readSentHash, readSketch, readSnapshot, writeSentHash } from "../store/sketches.ts";

/** Input kinds that are the learner speaking (not continues, steers, practice moves). */
const CARRIERS = new Set(["text", "answer"]);

export function attachSketch(chatId: string, inputType: string, appends: LhMessage[]): LhMessage[] {
	if (!CARRIERS.has(inputType)) return appends;
	let png: Buffer | null;
	try {
		png = readSnapshot(chatId);
	} catch (err) {
		console.error(`[chat ${chatId}] sketch snapshot unreadable:`, err);
		return appends;
	}
	if (!png) return appends;
	const hash = crypto.createHash("sha256").update(png).digest("hex");
	if (hash === readSentHash(chatId)) return appends;

	const index = appends.findLastIndex((m) => m.role === "user" || m.role === "toolResult");
	if (index < 0) return appends;
	const target = appends[index] as LhMessage & { content: string | Array<TextContent | ImageContent> };
	const blocks: Array<TextContent | ImageContent> = [
		{ type: "text", text: sketchCaption(sketchTypedText(readSketch(chatId))) },
		{ type: "image", data: png.toString("base64"), mimeType: "image/png" },
	];
	const content = typeof target.content === "string" ? [{ type: "text" as const, text: target.content }, ...blocks] : [...target.content, ...blocks];

	writeSentHash(chatId, hash);
	const out = [...appends];
	out[index] = { ...target, content } as LhMessage;
	return out;
}
