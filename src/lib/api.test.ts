import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "./api";
import type { Observation, Session } from "./types";

// Only identity matters to history loading; response data is otherwise passed through.
const session = (id: string) => ({ id }) as Session;
const observation = (id: string) => ({ id }) as Observation;
const json = (body: unknown, status = 200) => Response.json(body, { status });

afterEach(() => vi.unstubAllGlobals());

describe("complete history loading", () => {
  it("loads every session beyond the first 1,500 records", async () => {
    const first = Array.from({ length: 1500 }, (_, index) => session(`session-${index}`));
    const last = [session("session-1500"), session("session-1501")];
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ sessions: first, truncated: true, nextCursor: "older-sessions" }))
      .mockResolvedValueOnce(json({ sessions: last, truncated: false, nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);

    const result = await api.listSessions("routine-1");

    expect(result.sessions).toEqual([...first, ...last]);
    expect(result.truncated).toBe(false);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/routines/routine-1/sessions",
      "/api/routines/routine-1/sessions?cursor=older-sessions",
    ]);
  });

  it("loads all checks and avoids double-counting a record moved during pagination", async () => {
    const first = observation("check-1");
    const last = observation("check-2");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ observations: [first], truncated: true, nextCursor: "older-checks" }))
      .mockResolvedValueOnce(json({ observations: [first, last], truncated: false, nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);

    expect(await api.listObservations("routine-1")).toEqual({
      observations: [first, last],
      truncated: false,
      nextCursor: null,
    });
    expect(fetcher.mock.calls[1][0]).toBe("/api/routines/routine-1/observations?cursor=older-checks");
  });

  it("rejects a later-page failure instead of returning partial statistics", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ sessions: [session("first")], truncated: true, nextCursor: "older" }))
      .mockResolvedValueOnce(json({ error: "Unable to load sessions" }, 500));
    vi.stubGlobal("fetch", fetcher);

    await expect(api.listSessions("routine-1")).rejects.toThrow("Unable to load sessions");
  });

  it("rejects an incomplete page without a continuation cursor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ observations: [], truncated: true })));

    await expect(api.listObservations("routine-1")).rejects.toBeInstanceOf(ApiError);
  });

  it("stops if the server repeats a cursor", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(json({
      sessions: [session("first")], truncated: true, nextCursor: "same-cursor",
    })));
    vi.stubGlobal("fetch", fetcher);

    await expect(api.listSessions("routine-1")).rejects.toThrow("Unable to load the complete history");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
