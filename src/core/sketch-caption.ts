/**
 * The sketch caption (fork feature, 2026-10-26): the text block that rides
 * with a sketch snapshot attached to the learner's input
 * (src/server/sketch-attach.ts). The model reads the full caption; the
 * transcript (view.ts) shows a short note in its place.
 */

export const SKETCH_CAPTION_PREFIX = "[Sketch attached]";

/** What the learner sees in place of the caption. */
export const SKETCH_CAPTION_NOTE = "✎ Sketch sent with this message";

export function isSketchCaption(text: string): boolean {
	return text.startsWith(SKETCH_CAPTION_PREFIX);
}

/** The caption for a snapshot, with any text typed onto the canvas spelled out. */
export function sketchCaption(typedText: readonly string[]): string {
	const lines = [
		`${SKETCH_CAPTION_PREFIX} The image below is the learner's sketch canvas for this session, as it is now. It changed since you last saw it. He draws and writes by hand there while working; read it as his working, and refer to it when it helps.`,
	];
	if (typedText.length > 0) {
		lines.push("Text typed on the canvas (exact):", ...typedText.map((t) => `- ${t}`));
	}
	return lines.join("\n");
}

/** The typed text elements of a serialized Excalidraw scene, in canvas order. */
export function sketchTypedText(sceneJson: string | null): string[] {
	if (!sceneJson) return [];
	try {
		const scene = JSON.parse(sceneJson) as { elements?: Array<{ type?: string; isDeleted?: boolean; text?: string }> };
		return (scene.elements ?? [])
			.filter((el) => el.type === "text" && !el.isDeleted && typeof el.text === "string" && el.text.trim())
			.map((el) => (el.text as string).trim().replace(/\s*\n\s*/g, " / "));
	} catch {
		return [];
	}
}
