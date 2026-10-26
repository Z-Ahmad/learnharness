"use client";

/**
 * The Excalidraw canvas itself (fork feature, 2026-10-26). Client-only: the
 * panel loads it through next/dynamic with ssr off, since Excalidraw needs
 * window. Loads the chat's scene once, then autosaves after a short pause.
 *
 * Each save also renders a PNG snapshot (light, white background — clearest
 * for the model) when the drawing itself changed; the server attaches it to
 * the learner's next message (src/server/sketch-attach.ts). Before any send,
 * session-core flushes a pending save through components/sketch-flush.ts.
 */

import "@excalidraw/excalidraw/index.css";
import { Excalidraw, exportToBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { registerSketchFlush } from "@/components/sketch-flush";

const SAVE_DELAY_MS = 800;
/** Anthropic's recommended long edge for image input. */
const SNAPSHOT_MAX_EDGE = 1568;

type Status = "loading" | "ready" | "error";
type Elements = Parameters<typeof serializeAsJSON>[0];
type Scene = { elements: Elements; appState: AppState; files: BinaryFiles };

/** Changes when the drawing changes — not when you pan, zoom or select. */
function drawingKey(elements: Elements, files: BinaryFiles): string {
	return `${elements.map((el) => `${el.id}:${el.version}`).join(",")}|${Object.keys(files).sort().join(",")}`;
}

export default function SketchCanvas({ chatId, onSaveState }: { chatId: string; onSaveState?: (s: "saving" | "saved" | "failed") => void }) {
	const [status, setStatus] = useState<Status>("loading");
	const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
	const lastSaved = useRef<string | null>(null);
	const lastSnapshotKey = useRef<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pending = useRef<{ json: string; scene: Scene } | null>(null);
	const inflight = useRef<Promise<void> | null>(null);

	useEffect(() => {
		let live = true;
		setStatus("loading");
		lastSaved.current = null;
		// A freshly opened canvas re-renders once on its first save, so the
		// server always has a snapshot matching the scene on disk.
		lastSnapshotKey.current = null;
		fetch(`/api/chats/${encodeURIComponent(chatId)}/sketch`)
			.then(async (r) => {
				if (r.status === 204) return null;
				if (!r.ok) throw new Error(`sketch ${r.status}`);
				return r.text();
			})
			.then((text) => {
				if (!live) return;
				lastSaved.current = text;
				const scene = text ? (JSON.parse(text) as ExcalidrawInitialDataState) : {};
				setInitial({ ...scene, scrollToContent: true });
				setStatus("ready");
			})
			.catch(() => live && setStatus("error"));
		return () => {
			live = false;
		};
	}, [chatId]);

	async function snapshot(id: string, { elements, appState, files }: Scene) {
		const url = `/api/chats/${encodeURIComponent(id)}/sketch/snapshot`;
		const visible = elements.filter((el) => !el.isDeleted);
		if (visible.length === 0) {
			await fetch(url, { method: "DELETE" });
			return;
		}
		const png = await exportToBlob({
			elements: visible,
			appState: { ...appState, exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" },
			files,
			mimeType: "image/png",
			maxWidthOrHeight: SNAPSHOT_MAX_EDGE,
			exportPadding: 24,
		});
		const r = await fetch(url, { method: "PUT", headers: { "content-type": "image/png" }, body: png });
		if (!r.ok) throw new Error(`snapshot ${r.status}`);
	}

	async function save(id: string) {
		const next = pending.current;
		if (!next) return;
		pending.current = null;
		onSaveState?.("saving");
		try {
			const r = await fetch(`/api/chats/${encodeURIComponent(id)}/sketch`, { method: "PUT", body: next.json });
			if (!r.ok) throw new Error(`sketch ${r.status}`);
			lastSaved.current = next.json;
			const key = drawingKey(next.scene.elements, next.scene.files);
			if (key !== lastSnapshotKey.current) {
				await snapshot(id, next.scene);
				lastSnapshotKey.current = key;
			}
			onSaveState?.("saved");
		} catch {
			onSaveState?.("failed");
		}
	}

	/** Save now if a save is waiting; wait for one already running. */
	function flush(id: string): Promise<void> {
		if (timer.current) {
			clearTimeout(timer.current);
			timer.current = null;
		}
		const run = (inflight.current ?? Promise.resolve()).then(() => save(id));
		inflight.current = run;
		return run;
	}

	// The send path flushes through this, and so does closing the panel or
	// switching chats.
	useEffect(() => {
		const unregister = registerSketchFlush(() => flush(chatId));
		return () => {
			unregister();
			void flush(chatId);
		};
		// flush reads refs only; re-registering per chat is the point.
	}, [chatId]);

	if (status === "loading") return <div className="p-4 text-xs text-muted-foreground">Loading sketch…</div>;
	if (status === "error") return <div className="p-4 text-xs text-destructive">Couldn't load this session's sketch.</div>;

	return (
		<Excalidraw
			initialData={initial}
			theme="dark"
			UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
			onChange={(elements, appState, files) => {
				// onChange also fires for pointer moves, selection and scrolling;
				// only a changed serialized scene is worth a write.
				// No file until there's something on it: opening an empty canvas
				// shouldn't leave an empty sketch behind.
				if (lastSaved.current === null && !elements.some((el) => !el.isDeleted)) return;
				const json = serializeAsJSON(elements, appState, files, "local");
				if (json === lastSaved.current || json === pending.current?.json) return;
				pending.current = { json, scene: { elements, appState, files } };
				if (timer.current) clearTimeout(timer.current);
				timer.current = setTimeout(() => void flush(chatId), SAVE_DELAY_MS);
			}}
		/>
	);
}
