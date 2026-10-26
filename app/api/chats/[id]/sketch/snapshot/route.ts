/**
 * THE SKETCH SNAPSHOT (fork feature, 2026-10-26): the PNG rendering of a
 * session's sketch that the teacher is shown (src/server/sketch-attach.ts).
 * The canvas exports one with every save.
 *
 * PUT /api/chats/:id/sketch/snapshot (body: image/png) stores it; DELETE clears it
 * (an emptied canvas). 404 unknown chat; 400 for anything that isn't a PNG.
 */
import { deleteSnapshot, getChat, writeSnapshot } from "@/src/server";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "Unknown chat" }, { status: 404 });
	try {
		writeSnapshot(id, Buffer.from(await req.arrayBuffer()));
	} catch (err) {
		return Response.json({ error: (err as Error).message }, { status: 400 });
	}
	return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "Unknown chat" }, { status: 404 });
	deleteSnapshot(id);
	return new Response(null, { status: 204 });
}
