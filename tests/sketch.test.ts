/**
 * THE SESSION SKETCH (fork feature, 2026-10-26): the store
 * (src/store/sketches.ts) and its route (GET/PUT /api/chats/:id/sketch).
 * Pins: 404 unknown chat, 204 before the first save, a round trip of the
 * exact bytes, refusal of anything that isn't an Excalidraw scene, and the
 * chat-id guard that keeps a crafted id out of other paths.
 *
 * Runs under an isolated LH_DATA_DIR, set before any config-loading import
 * (so every app-module import is dynamic), like markdown-export.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-sketch-"));
process.env.LH_DATA_DIR = TMP_DATA;

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let GET: Handler;
let PUT: Handler;
let createChat: (title: string) => { id: string };
let writeSketch: (chatId: string, json: string) => void;

before(async () => {
	const route = await import("../app/api/chats/[id]/sketch/route.ts");
	GET = route.GET;
	PUT = route.PUT;
	createChat = (await import("../src/server/chats.ts")).createChat;
	writeSketch = (await import("../src/store/sketches.ts")).writeSketch;
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const scene = (n: number) =>
	JSON.stringify({ type: "excalidraw", version: 2, source: "test", elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })), appState: {}, files: {} });

describe("/api/chats/:id/sketch", () => {
	it("404s an unknown chat, both ways", async () => {
		assert.equal((await GET(new Request("http://x"), params("nope"))).status, 404);
		assert.equal((await PUT(new Request("http://x", { method: "PUT", body: scene(1) }), params("nope"))).status, 404);
	});

	it("answers 204 before the first save", async () => {
		const chat = createChat("Empty canvas");
		assert.equal((await GET(new Request("http://x"), params(chat.id))).status, 204);
	});

	it("round-trips the saved scene byte for byte, and the last save wins", async () => {
		const chat = createChat("Drawn on");
		assert.equal((await PUT(new Request("http://x", { method: "PUT", body: scene(1) }), params(chat.id))).status, 204);
		assert.equal((await PUT(new Request("http://x", { method: "PUT", body: scene(3) }), params(chat.id))).status, 204);
		const res = await GET(new Request("http://x"), params(chat.id));
		assert.equal(res.status, 200);
		assert.equal(await res.text(), scene(3));
		assert.ok(fs.existsSync(path.join(TMP_DATA, "sketches", `${chat.id}.excalidraw`)), "stored as a plain .excalidraw file");
	});

	it("refuses anything that isn't an Excalidraw scene, keeping the previous one", async () => {
		const chat = createChat("Guarded");
		await PUT(new Request("http://x", { method: "PUT", body: scene(2) }), params(chat.id));
		for (const body of ["not json", JSON.stringify({ type: "other", elements: [] }), JSON.stringify({ type: "excalidraw" })]) {
			assert.equal((await PUT(new Request("http://x", { method: "PUT", body }), params(chat.id))).status, 400, body);
		}
		assert.equal(await (await GET(new Request("http://x"), params(chat.id))).text(), scene(2));
	});

	it("rejects a chat id that could escape the sketches folder", () => {
		assert.throws(() => writeSketch("../escape", scene(1)), /Invalid chat id/);
	});
});

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

// ── Snapshots: the PNG route and attaching a changed sketch to the next input ──

describe("sketch snapshots → the teacher", async () => {
	const { attachSketch } = await import("../src/server/sketch-attach.ts");
	const { newAnswerResult, newUserMessage } = await import("../src/core/native-messages.ts");
	const { projectView } = await import("../src/core/view.ts");
	const { SKETCH_CAPTION_NOTE } = await import("../src/core/sketch-caption.ts");
	const snapshotRoute = await import("../app/api/chats/[id]/sketch/snapshot/route.ts");

	const png = (tag: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
	const putPng = (id: string, body: Buffer) => snapshotRoute.PUT(new Request("http://x", { method: "PUT", body }), params(id));
	type Block = { type: string; text?: string; data?: string; mimeType?: string };
	const blocksOf = (m: unknown) => (m as { content: Block[] }).content;

	it("the snapshot route stores PNGs, refuses anything else, and DELETE clears it", async () => {
		const chat = createChat("Snap route");
		assert.equal((await putPng(chat.id, png("a"))).status, 204);
		assert.equal((await snapshotRoute.PUT(new Request("http://x", { method: "PUT", body: "<svg/>" }), params(chat.id))).status, 400);
		assert.equal((await putPng("nope", png("a"))).status, 404);
		assert.equal((await snapshotRoute.DELETE(new Request("http://x"), params(chat.id))).status, 204);
		assert.equal(attachSketch(chat.id, "text", [newUserMessage("hi")])[0].content, "hi", "no snapshot, nothing attached");
	});

	it("attaches a changed snapshot to a text message once, with typed canvas text in the caption", async () => {
		const chat = createChat("Snap text");
		writeSketch(chat.id, JSON.stringify({ type: "excalidraw", elements: [{ type: "text", text: "P(A|B) = 0.3" }, { type: "freedraw" }], appState: {}, files: {} }));
		await putPng(chat.id, png("one"));

		const [msg] = attachSketch(chat.id, "text", [newUserMessage("does this look right?")]);
		const blocks = blocksOf(msg);
		assert.deepEqual(blocks.map((b) => b.type), ["text", "text", "image"]);
		assert.equal(blocks[0].text, "does this look right?");
		assert.ok(blocks[1].text?.startsWith("[Sketch attached]"));
		assert.ok(blocks[1].text?.includes("P(A|B) = 0.3"), "typed text is spelled out");
		assert.equal(blocks[2].mimeType, "image/png");
		assert.equal(Buffer.from(blocks[2].data ?? "", "base64").toString("latin1"), png("one").toString("latin1"));

		assert.equal(attachSketch(chat.id, "text", [newUserMessage("again")])[0].content, "again", "unchanged sketch is not resent");
		await putPng(chat.id, png("two"));
		assert.equal(blocksOf(attachSketch(chat.id, "text", [newUserMessage("changed")])[0]).length, 3, "a changed sketch goes again");
	});

	it("rides an answer's tool result, but never a continue", async () => {
		const chat = createChat("Snap answer");
		await putPng(chat.id, png("ans"));
		assert.deepEqual(attachSketch(chat.id, "continue", []), []);
		const result = newAnswerResult("call_1", "quiz", { kind: "quiz", answers: [], correct: true });
		const [withSketch] = attachSketch(chat.id, "answer", [result]);
		assert.deepEqual(blocksOf(withSketch).map((b) => b.type), ["text", "text", "image"]);
		assert.deepEqual((withSketch as { details?: unknown }).details, result.details, "the answer record itself is untouched");
	});

	it("the transcript shows a short note instead of the caption", async () => {
		const chat = createChat("Snap view");
		await putPng(chat.id, png("view"));
		const [msg] = attachSketch(chat.id, "text", [newUserMessage("look")]);
		const view = projectView([msg]);
		const texts = view[0].parts.map((p) => (p as { text?: string }).text);
		assert.deepEqual(texts, ["look", SKETCH_CAPTION_NOTE]);
	});
});
