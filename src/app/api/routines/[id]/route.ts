import { deleteRoutine, RoutineError, updateRoutine } from "@/db/routines";
import { error, json, noContent, parseBody, parseId, requireUser, serverError } from "@/lib/http";
import { idSchema, updateRoutineSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, ctx: RouteContext<"/api/routines/[id]">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid routine id", 400);

  const body = await parseBody(request, updateRoutineSchema);
  if ("response" in body) return body.response;

  try {
    const routine = await updateRoutine(user.userId, id, body.data);
    return routine ? json({ routine }) : error("Routine not found", 404);
  } catch (cause) {
    if (cause instanceof RoutineError) return error(cause.message, 409, { code: cause.code });
    return serverError("Failed to update routine", cause, "Unable to update this routine");
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/routines/[id]">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid routine id", 400);

  try {
    return (await deleteRoutine(user.userId, id)) ? noContent() : error("Routine not found", 404);
  } catch (cause) {
    return serverError("Failed to delete routine", cause, "Unable to delete this routine");
  }
}
