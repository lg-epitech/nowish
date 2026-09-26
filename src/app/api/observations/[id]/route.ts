import { deleteObservation, updateObservation } from "@/db/observations";
import { error, json, noContent, parseBody, parseId, requireUser, serverError } from "@/lib/http";
import { idSchema, updateObservationSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(request: Request, ctx: RouteContext<"/api/observations/[id]">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid check id", 400);

  const body = await parseBody(request, updateObservationSchema);
  if ("response" in body) return body.response;

  try {
    const observation = await updateObservation(user.userId, id, body.data);
    return observation ? json({ observation }) : error("Check not found", 404);
  } catch (cause) {
    return serverError("Failed to update observation", cause, "Unable to update this check");
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/observations/[id]">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid check id", 400);

  try {
    return (await deleteObservation(user.userId, id)) ? noContent() : error("Check not found", 404);
  } catch (cause) {
    return serverError("Failed to delete observation", cause, "Unable to delete this check");
  }
}
