import { deleteSession, SessionError, updateSession } from "@/db/sessions";
import { error, json, noContent, parseBody, parseId, requireUser, serverError } from "@/lib/http";
import { idSchema, updateSessionSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid session id", 400);

  const body = await parseBody(request, updateSessionSchema);
  if ("response" in body) return body.response;

  try {
    const session = await updateSession(user.userId, id, body.data);
    return session ? json({ session }) : error("Session not found", 404);
  } catch (cause) {
    if (cause instanceof SessionError) return error(cause.message, 400);
    return serverError("Failed to update session", cause, "Unable to update this session");
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid session id", 400);

  try {
    return (await deleteSession(user.userId, id)) ? noContent() : error("Session not found", 404);
  } catch (cause) {
    return serverError("Failed to delete session", cause, "Unable to delete this session");
  }
}
