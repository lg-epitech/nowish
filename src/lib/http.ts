import { auth } from "@clerk/nextjs/server";
import type { z } from "zod";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_NO_STORE });
}

export function noContent() {
  return new Response(null, { status: 204, headers: PRIVATE_NO_STORE });
}

export function error(message: string, status: number, extra?: Record<string, unknown>) {
  return json({ error: message, ...extra }, status);
}

function issues(zodError: z.ZodError) {
  return zodError.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** The signed-in Clerk user, or a 401 response to return as-is. */
export async function requireUser(): Promise<{ userId: string } | { response: Response }> {
  const { userId } = await auth();
  return userId ? { userId } : { response: error("Unauthorized", 401) };
}

export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { response: error("Invalid JSON body", 400) };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { response: error("Invalid request", 400, { issues: issues(parsed.error) }) };
  }

  return { data: parsed.data };
}

export async function parseId(params: Promise<{ id: string }>, schema: z.ZodType<string>) {
  const parsed = schema.safeParse((await params).id);
  return parsed.success ? parsed.data : null;
}

export function serverError(context: string, cause: unknown, message: string) {
  console.error(context, cause);
  return error(message, 500);
}
