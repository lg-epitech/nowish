import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { encodeHistoryCursor, InvalidHistoryCursorError, parseHistoryCursor } from "./history-cursor";

describe("history cursors", () => {
  const at = new Date("2026-09-20T07:30:00.123Z");
  const id = "a95861d0-1c56-4d2e-93ea-f06203b803fa";
  const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString("base64url");

  it("preserves the timestamp and unique tie breaker", () => {
    expect(parseHistoryCursor(encodeHistoryCursor(at, id))).toEqual({ at, id });
    expect(parseHistoryCursor(null)).toBeNull();
  });

  it.each([
    "",
    "%%%",
    "a".repeat(257),
    Buffer.from("not json").toString("base64url"),
    encode({ at: "not a date", id }),
    encode({ at: "2026-02-30T00:00:00.000Z", id }),
    encode({ at: at.toISOString(), id: "not a UUID" }),
    encode({ at: at.toISOString() }),
    encode({ at: at.toISOString(), id, userId: "someone-else" }),
  ])("rejects malformed positions: %s", (value) => {
    expect(() => parseHistoryCursor(value)).toThrow(InvalidHistoryCursorError);
  });
});
