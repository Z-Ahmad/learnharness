/**
 * The sketch flush seam (fork feature, 2026-10-26): before any input event
 * is sent (session-core.ts postInputEvent), a pending sketch save — and its
 * snapshot — lands on the server, so a stroke drawn just before Submit is
 * what the teacher sees. The open canvas registers its flush; with no
 * canvas open this is a no-op.
 */

let flusher: (() => Promise<void>) | null = null;

/** The open canvas registers itself; returns the unregister. */
export function registerSketchFlush(fn: () => Promise<void>): () => void {
	flusher = fn;
	return () => {
		if (flusher === fn) flusher = null;
	};
}

/** Land any pending sketch save. Never blocks a send for long, never throws. */
export async function flushSketch(timeoutMs = 3000): Promise<void> {
	if (!flusher) return;
	await Promise.race([flusher().catch(() => {}), new Promise((r) => setTimeout(r, timeoutMs))]);
}
