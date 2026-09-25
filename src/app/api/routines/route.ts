import { createRoutine, ensureProfile, listRoutines, RoutineError } from "@/db/routines";
import { error, json, parseBody, requireUser, serverError } from "@/lib/http";
import { isIanaTimezone } from "@/lib/time";
import { createRoutineSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const timezone = new URL(request.url).searchParams.get("tz");

  try {
    await ensureProfile(user.userId, timezone && isIanaTimezone(timezone) ? timezone : "UTC");
    return json({ routines: await listRoutines(user.userId) });
  } catch (cause) {
    return serverError("Failed to list routines", cause, "Unable to load your routines");
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = await parseBody(request, createRoutineSchema);
  if ("response" in body) return body.response;

  try {
    return json({ routine: await createRoutine(user.userId, body.data) }, 201);
  } catch (cause) {
    if (cause instanceof RoutineError) {
      return error(cause.message, cause.code === "limit" ? 422 : 409, { code: cause.code });
    }
    return serverError("Failed to create routine", cause, "Unable to add this routine");
  }
}
