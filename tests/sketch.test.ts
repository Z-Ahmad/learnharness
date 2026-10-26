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
