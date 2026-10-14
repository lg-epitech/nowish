import type {
  Observation,
  ObservationsResponse,
  Routine,
  RoutinesResponse,
  Session,
  SessionsResponse,
} from "@/lib/types";
import type {
  CreateObservationInput,
  CreateRoutineInput,
  CreateSessionInput,
  UpdateObservationInput,
  UpdateRoutineInput,
  UpdateSessionInput,
} from "@/lib/validation";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(body.error || "Something went wrong. Try again.", response.status);
  }

  return body as T;
}

async function requestHistory<
  Entry extends { id: string },
  Page extends { truncated: boolean; nextCursor?: string | null },
>(path: string, entriesFrom: (page: Page) => Entry[]): Promise<Entry[]> {
  const entries: Entry[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const page: Page = await request<Page>(cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path);

    for (const entry of entriesFrom(page)) {
      // An entry edited while history loads can move between pages.
      if (!seenIds.has(entry.id)) {
        entries.push(entry);
        seenIds.add(entry.id);
      }
    }

    cursor = page.nextCursor ?? null;
    if ((page.truncated && !cursor) || (cursor && seenCursors.has(cursor))) {
      throw new ApiError("Unable to load the complete history. Refresh and try again.", 502);
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return entries;
}

type RoutineBody = Omit<CreateRoutineInput, "timezone">;
type SessionBody = Omit<CreateSessionInput, "source"> & { source?: CreateSessionInput["source"] };

export const api = {
  listRoutines: (timezone: string) =>
    request<RoutinesResponse>(`/api/routines?tz=${encodeURIComponent(timezone)}`),
  createRoutine: (body: RoutineBody & { timezone: string }) =>
    request<{ routine: Routine }>("/api/routines", { method: "POST", body: JSON.stringify(body) }),
  updateRoutine: (id: string, body: UpdateRoutineInput) =>
    request<{ routine: Routine }>(`/api/routines/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRoutine: (id: string) => request<void>(`/api/routines/${id}`, { method: "DELETE" }),
  listSessions: async (routineId: string): Promise<SessionsResponse> => ({
    sessions: await requestHistory<Session, SessionsResponse>(
      `/api/routines/${routineId}/sessions`,
      (page) => page.sessions,
    ),
    truncated: false,
    nextCursor: null,
  }),
  createSession: (routineId: string, body: SessionBody) =>
    request<{ session: Session }>(`/api/routines/${routineId}/sessions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSession: (id: string, body: UpdateSessionInput) =>
    request<{ session: Session }>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  convertSession: (id: string, body: CreateObservationInput) =>
    request<{ observation: Observation }>(`/api/sessions/${id}/convert`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listObservations: async (routineId: string): Promise<ObservationsResponse> => ({
    observations: await requestHistory<Observation, ObservationsResponse>(
      `/api/routines/${routineId}/observations`,
      (page) => page.observations,
    ),
    truncated: false,
    nextCursor: null,
  }),
  createObservation: (routineId: string, body: CreateObservationInput) =>
    request<{ observation: Observation }>(`/api/routines/${routineId}/observations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateObservation: (id: string, body: UpdateObservationInput) =>
    request<{ observation: Observation }>(`/api/observations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteObservation: (id: string) => request<void>(`/api/observations/${id}`, { method: "DELETE" }),
};

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
