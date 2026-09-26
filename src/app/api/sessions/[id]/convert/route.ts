import { convertSession } from "@/db/observations";
import { error, json, parseBody, parseId, requireUser, serverError } from "@/lib/http";
import { createObservationSchema, idSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Turns a session that was really only a check into one. */
export async function POST(request: Request, ctx: RouteContext<"/api/sessions/[id]/convert">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid session id", 400);

  const body = await parseBody(request, createObservationSchema);
  if ("response" in body) return body.response;

  try {
    const observation = await convertSession(user.userId, id, body.data);
    return observation ? json({ observation }, 201) : error("Session not found", 404);
  } catch (cause) {
    return serverError("Failed to convert session", cause, "Unable to turn this into a check");
  }
}
