import { createSession, listSessions } from "@/db/sessions";
import { error, json, parseBody, parseId, requireUser, serverError } from "@/lib/http";
import { createSessionSchema, idSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: RouteContext<"/api/routines/[id]/sessions">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid routine id", 400);

  try {
    const page = await listSessions(user.userId, id);
    return page ? json(page) : error("Routine not found", 404);
  } catch (cause) {
    return serverError("Failed to list sessions", cause, "Unable to load sessions");
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/routines/[id]/sessions">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid routine id", 400);

  const body = await parseBody(request, createSessionSchema);
  if ("response" in body) return body.response;

  try {
    const session = await createSession(user.userId, id, body.data);
    return session ? json({ session }, 201) : error("Routine not found", 404);
  } catch (cause) {
    return serverError("Failed to create session", cause, "Unable to log this session");
  }
}
