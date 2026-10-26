/**
 * THE SESSION SKETCH (fork feature, 2026-10-26): the Excalidraw canvas
 * beside a session (components/sketch-panel.tsx).
 *
 * GET /api/chats/:id/sketch → the stored scene (Excalidraw JSON), or
 * 204 when this chat has none yet. PUT the serialized scene to save it.
 * 404 unknown chat; 400 for anything that isn't an Excalidraw scene.
 */
import { getChat, readSketch, writeSketch } from "@/src/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const scene = readSketch(id);
	if (scene === null) return new Response(null, { status: 204 });
	return new Response(scene, { headers: { "content-type": "application/json; charset=utf-8" } });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "Unknown chat" }, { status: 404 });
	try {
		writeSketch(id, await req.text());
	} catch (err) {
		return Response.json({ error: (err as Error).message }, { status: 400 });
	}
	return new Response(null, { status: 204 });
}
