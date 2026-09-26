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
  listSessions: (routineId: string) => request<SessionsResponse>(`/api/routines/${routineId}/sessions`),
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
  listObservations: (routineId: string) =>
    request<ObservationsResponse>(`/api/routines/${routineId}/observations`),
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
