/**
 * Per-session sketches (fork feature, 2026-10-26): the Excalidraw scratch
 * canvas beside a session. data/sketches/<chatId>.excalidraw — one file per
 * chat, whole-file read-modify-write like the chats, NOT a ledger.
 *
 * The file is Excalidraw's own JSON export format ({type: "excalidraw",
 * elements, appState, files}), so it opens as-is on excalidraw.com and in
 * Obsidian's Excalidraw plugin. This module only moves bytes: the client
 * serializes, and we check the shape and size before writing. Beside each
 * scene: <chatId>.png (its latest rendering) and <chatId>.sent (the hash of
 * the rendering last shown to the teacher).
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";

const SKETCHES_DIR = path.join(PATHS.data, "sketches");

/** Pasted images ride inside the file as data URLs, so allow some room. */
export const MAX_SKETCH_BYTES = 25 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chatFile(chatId: string, ext: "excalidraw" | "png" | "sent"): string {
	if (!/^[A-Za-z0-9_-]+$/.test(chatId)) throw new Error(`Invalid chat id: ${chatId}`);
	return path.join(SKETCHES_DIR, `${chatId}.${ext}`);
}

function readOrNull(file: string): Buffer | null {
	try {
		return fs.readFileSync(file);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/** Write-then-rename: a crash mid-write never leaves half a file behind. */
function writeAtomic(file: string, data: string | Buffer): void {
	fs.mkdirSync(SKETCHES_DIR, { recursive: true });
	fs.writeFileSync(`${file}.tmp`, data);
	fs.renameSync(`${file}.tmp`, file);
}

/** The stored scene as JSON text, or null when this chat has no sketch yet. */
export function readSketch(chatId: string): string | null {
	return readOrNull(chatFile(chatId, "excalidraw"))?.toString("utf-8") ?? null;
}

/** Persist a serialized scene. Refuses anything that isn't an Excalidraw scene. */
export function writeSketch(chatId: string, json: string): void {
	if (Buffer.byteLength(json, "utf-8") > MAX_SKETCH_BYTES) throw new Error("Sketch too large");
	const scene = JSON.parse(json) as { type?: unknown; elements?: unknown };
	if (scene?.type !== "excalidraw" || !Array.isArray(scene.elements)) throw new Error("Not an Excalidraw scene");
	writeAtomic(chatFile(chatId, "excalidraw"), json);
}

// ── Snapshots: what the teacher sees (src/server/sketch-attach.ts) ──

/** The latest rendering, or null when there is none (no sketch, or emptied). */
export function readSnapshot(chatId: string): Buffer | null {
	return readOrNull(chatFile(chatId, "png"));
}

/** Store the latest rendering (the client exports one with each save). */
export function writeSnapshot(chatId: string, png: Buffer): void {
	if (png.length > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot too large");
	if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) throw new Error("Not a PNG");
	writeAtomic(chatFile(chatId, "png"), png);
}

/** An emptied canvas has nothing to show the teacher. */
export function deleteSnapshot(chatId: string): void {
	fs.rmSync(chatFile(chatId, "png"), { force: true });
}

/** Hash of the snapshot last attached to a turn, so an unchanged sketch isn't sent twice. */
export function readSentHash(chatId: string): string | null {
	return readOrNull(chatFile(chatId, "sent"))?.toString("utf-8").trim() || null;
}

export function writeSentHash(chatId: string, hash: string): void {
	writeAtomic(chatFile(chatId, "sent"), hash);
}
