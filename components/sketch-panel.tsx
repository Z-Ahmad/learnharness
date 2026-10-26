"use client";

/**
 * The sketch panel (fork feature, 2026-10-26): an Excalidraw scratch canvas
 * per session, toggled from the top bar's Sketch chip.
 *
 * - Wide windows: a full-height column on the right that the transcript
 *   shrinks beside. Drag its left edge to resize.
 * - Narrow windows (about half a screen): a drawer over the right side.
 *
 * Keys pressed while drawing stop at the panel's edge, so Excalidraw's own
 * shortcuts never reach the app's (Enter submitting an answer, Esc aborting
 * a turn). Open state and width are per-device conveniences (localStorage).
 */

import dynamic from "next/dynamic";
import { PencilLineIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { Hint } from "@/components/ui/hint";

const SketchCanvas = dynamic(() => import("@/components/sketch-canvas"), {
	ssr: false,
	loading: () => <div className="p-4 text-xs text-muted-foreground">Loading sketch…</div>,
});

/** Below this window width the panel becomes a drawer. */
const SIDE_PANEL_MIN_WINDOW = 1200;
const WIDTH_MIN = 320;
const WIDTH_DEFAULT = 560;
const WIDTH_SHARE = 0.36;
/** What the rest of the window (sidebar + transcript) always keeps. */
const KEEP_FOR_SESSION = 600;
const maxWidth = () => Math.max(WIDTH_MIN, window.innerWidth - KEEP_FOR_SESSION);
const OPEN_KEY = "lh-sketch-open";
const WIDTH_KEY = "lh-sketch-width";

function readStored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function writeStored(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* private window or blocked storage: the panel just won't remember */
	}
}

function useWideWindow(): boolean {
	const query = `(min-width: ${SIDE_PANEL_MIN_WINDOW}px)`;
	return useSyncExternalStore(
		(onChange) => {
			const mq = window.matchMedia(query);
			mq.addEventListener("change", onChange);
			return () => mq.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => true,
	);
}

/** Open/closed state for the session's sketch panel, remembered per device. */
export function useSketchPanel() {
	const [open, setOpen] = useState(false);
	useEffect(() => setOpen(readStored(OPEN_KEY) === "1"), []);
	const set = useCallback((next: boolean) => {
		setOpen(next);
		writeStored(OPEN_KEY, next ? "1" : "0");
	}, []);
	return { open, setOpen: set, toggle: () => set(!open) };
}

/** The top-bar chip, styled like the Plan chip beside it. */
export function SketchChip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<Hint label={open ? "Close the sketch" : "Open a sketch for this session"} side="bottom">
			<button
				type="button"
				data-testid="sketch-chip"
				aria-pressed={open}
				onClick={(e) => {
					blurAfterPointerClick(e);
					onToggle();
				}}
				className={`lh-no-drag flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide transition-colors hover:border-border hover:text-foreground ${
					open ? "border-border text-foreground" : "border-border/80 text-muted-foreground"
				}`}
			>
				<PencilLineIcon className="size-3.5 text-primary" aria-hidden />
				Sketch
			</button>
		</Hint>
	);
}

export function SketchPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
	const wide = useWideWindow();
	const [width, setWidth] = useState(WIDTH_DEFAULT);
	const [saveState, setSaveState] = useState<"saving" | "saved" | "failed" | null>(null);

	useEffect(() => {
		const stored = Number(readStored(WIDTH_KEY));
		// No saved width yet: a share of the window, so the transcript keeps room.
		setWidth(Math.min(maxWidth(), stored >= WIDTH_MIN ? stored : Math.round(window.innerWidth * WIDTH_SHARE)));
	}, []);

	// Excalidraw takes its keys through a React onKeyDown on its container
	// (handleKeyboardGlobally is off), and React listens at the document. So
	// stop keys in React's handler here, after Excalidraw's: a native stop on
	// this element would starve Excalidraw too. stopImmediatePropagation keeps
	// them from the app's later document/window shortcut listeners. Keyup is
	// left alone: Excalidraw tracks releases (space-drag) on the document.
	const keepKeysInside = (e: React.KeyboardEvent) => {
		e.stopPropagation();
		e.nativeEvent.stopImmediatePropagation();
	};

	function startResize(e: React.PointerEvent<HTMLDivElement>) {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = width;
		const max = maxWidth();
		let latest = startWidth;
		const move = (ev: PointerEvent) => {
			latest = Math.min(max, Math.max(WIDTH_MIN, startWidth + (startX - ev.clientX)));
			setWidth(latest);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			writeStored(WIDTH_KEY, String(Math.round(latest)));
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	const header = (
		<div className="flex h-15 shrink-0 items-center gap-2 border-b border-border px-4">
			<PencilLineIcon className="size-4 text-primary" aria-hidden />
			<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sketch</span>
			<span className="text-xs text-muted-foreground/70" data-testid="sketch-save-state">
				{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "failed" ? "Not saved" : ""}
			</span>
			<div className="flex-1" />
			<button
				type="button"
				onClick={onClose}
				aria-label="Close the sketch"
				className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				<XIcon className="size-4" />
			</button>
		</div>
	);

	const body = (
		<div onKeyDown={keepKeysInside} className="relative min-h-0 flex-1">
			<div className="absolute inset-0">
				<SketchCanvas key={chatId} chatId={chatId} onSaveState={setSaveState} />
			</div>
		</div>
	);

	if (wide) {
		return (
			<aside
				data-testid="sketch-panel"
				data-mode="side"
				style={{ width }}
				className="relative flex h-dvh shrink-0 flex-col border-l border-border bg-background"
			>
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize the sketch"
					onPointerDown={startResize}
					className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/20"
				/>
				{header}
				{body}
			</aside>
		);
	}

	return (
		<aside
			data-testid="sketch-panel"
			data-mode="drawer"
			className="fixed inset-y-0 right-0 z-40 flex w-[min(92vw,560px)] flex-col border-l border-border bg-background shadow-2xl"
		>
			{header}
			{body}
		</aside>
	);
}
