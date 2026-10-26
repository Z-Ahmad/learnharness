/**
 * Per-session sketches (fork feature, 2026-10-26): the Excalidraw scratch
 * canvas beside a session. data/sketches/<chatId>.excalidraw — one file per
 * chat, whole-file read-modify-write like the chats, NOT a ledger.
 *
 * The file is Excalidraw's own JSON export format ({type: "excalidraw",
 * elements, appState, files}), so it opens as-is on excalidraw.com and in
 * Obsidian's Excalidraw plugin. This module only moves bytes: the client
 * serializes, and we check the shape and size before writing.
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";

const SKETCHES_DIR = path.join(PATHS.data, "sketches");

/** Pasted images ride inside the file as data URLs, so allow some room. */
export const MAX_SKETCH_BYTES = 25 * 1024 * 1024;

function sketchFile(chatId: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(chatId)) throw new Error(`Invalid chat id: ${chatId}`);
	return path.join(SKETCHES_DIR, `${chatId}.excalidraw`);
}

/** The stored scene as JSON text, or null when this chat has no sketch yet. */
export function readSketch(chatId: string): string | null {
	try {
		return fs.readFileSync(sketchFile(chatId), "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/** Persist a serialized scene. Refuses anything that isn't an Excalidraw scene. */
export function writeSketch(chatId: string, json: string): void {
	if (Buffer.byteLength(json, "utf-8") > MAX_SKETCH_BYTES) throw new Error("Sketch too large");
	const scene = JSON.parse(json) as { type?: unknown; elements?: unknown };
	if (scene?.type !== "excalidraw" || !Array.isArray(scene.elements)) throw new Error("Not an Excalidraw scene");
	const file = sketchFile(chatId);
	fs.mkdirSync(SKETCHES_DIR, { recursive: true });
	// Write-then-rename: a crash mid-write never leaves half a scene behind.
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, json, "utf-8");
	fs.renameSync(tmp, file);
}
