import { describe, expect, it } from "vitest";

import {
  addDays,
  circularMinuteDistance,
  daysBetween,
  isIanaTimezone,
  zonedParts,
} from "./time";

describe("zoned time", () => {
  it("reads wall-clock minute, weekday and offset in a timezone", () => {
    // 2026-09-24 11:30 UTC is 07:30 in Toronto (EDT, UTC-4), a Thursday.
    expect(zonedParts(Date.parse("2026-09-24T11:30:00Z"), "America/Toronto")).toEqual({
      localDate: "2026-09-24",
      localMinute: 450,
      localWeekday: 4,
      utcOffsetMinutes: -240,
    });
  });

  it("handles half-hour offsets and dates that roll over", () => {
    // 20:00 UTC on Sunday is 01:30 on Monday in Kolkata (UTC+5:30).
    expect(zonedParts(Date.parse("2026-09-27T20:00:00Z"), "Asia/Kolkata")).toEqual({
      localDate: "2026-09-28",
      localMinute: 90,
      localWeekday: 1,
      utcOffsetMinutes: 330,
    });
  });

  it("keeps the local minute stable across a DST change", () => {
    const summer = zonedParts(Date.parse("2026-10-24T05:30:00Z"), "Europe/Paris");
    const winter = zonedParts(Date.parse("2026-10-26T06:30:00Z"), "Europe/Paris");

    expect(summer.localMinute).toBe(450);
    expect(winter.localMinute).toBe(450);
    expect(summer.utcOffsetMinutes).toBe(120);
    expect(winter.utcOffsetMinutes).toBe(60);
  });

  it("validates IANA names", () => {
    expect(isIanaTimezone("Europe/Paris")).toBe(true);
    expect(isIanaTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("calendar helpers", () => {
  it("measures the short way around the clock", () => {
    expect(circularMinuteDistance(1430, 10)).toBe(20);
    expect(circularMinuteDistance(0, 720)).toBe(720);
    expect(circularMinuteDistance(450, 480)).toBe(30);
  });

  it("adds and diffs calendar days", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(daysBetween("2026-09-20", "2026-09-24")).toBe(4);
  });
});
