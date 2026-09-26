import { createObservation, listObservations } from "@/db/observations";
import { error, json, parseBody, parseId, requireUser, serverError } from "@/lib/http";
import { createObservationSchema, idSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: RouteContext<"/api/routines/[id]/observations">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid routine id", 400);

  try {
    const page = await listObservations(user.userId, id);
    return page ? json(page) : error("Routine not found", 404);
  } catch (cause) {
    return serverError("Failed to list observations", cause, "Unable to load checks");
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/routines/[id]/observations">) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const id = await parseId(ctx.params, idSchema);
  if (!id) return error("Invalid routine id", 400);

  const body = await parseBody(request, createObservationSchema);
  if ("response" in body) return body.response;

  try {
    const observation = await createObservation(user.userId, id, body.data);
    return observation ? json({ observation }, 201) : error("Routine not found", 404);
  } catch (cause) {
    return serverError("Failed to create observation", cause, "Unable to save this check");
  }
}
