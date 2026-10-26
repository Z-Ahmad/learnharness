"use client";

/**
 * The Excalidraw canvas itself (fork feature, 2026-10-26). Client-only: the
 * panel loads it through next/dynamic with ssr off, since Excalidraw needs
 * window. Loads the chat's scene once, then autosaves after a short pause.
 */

import "@excalidraw/excalidraw/index.css";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";

const SAVE_DELAY_MS = 800;

type Status = "loading" | "ready" | "error";

export default function SketchCanvas({ chatId, onSaveState }: { chatId: string; onSaveState?: (s: "saving" | "saved" | "failed") => void }) {
	const [status, setStatus] = useState<Status>("loading");
	const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
	const lastSaved = useRef<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pending = useRef<string | null>(null);

	useEffect(() => {
		let live = true;
		setStatus("loading");
		lastSaved.current = null;
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

	// Flush an unsaved change when the panel closes or the chat switches.
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
			if (pending.current !== null) void save(chatId, pending.current);
		},
		[chatId],
	);

	async function save(id: string, json: string) {
		pending.current = null;
		onSaveState?.("saving");
		try {
			const r = await fetch(`/api/chats/${encodeURIComponent(id)}/sketch`, { method: "PUT", body: json });
			if (!r.ok) throw new Error(`sketch ${r.status}`);
			lastSaved.current = json;
			onSaveState?.("saved");
		} catch {
			onSaveState?.("failed");
		}
	}

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
				if (json === lastSaved.current || json === pending.current) return;
				pending.current = json;
				if (timer.current) clearTimeout(timer.current);
				timer.current = setTimeout(() => {
					if (pending.current !== null) void save(chatId, pending.current);
				}, SAVE_DELAY_MS);
			}}
		/>
	);
}
