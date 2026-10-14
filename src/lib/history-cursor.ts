import { Buffer } from "node:buffer";
import { z } from "zod";

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();

export interface HistoryCursor {
  at: Date;
  id: string;
}

export class InvalidHistoryCursorError extends Error {
  constructor() {
    super("Invalid history cursor");
  }
}

export function encodeHistoryCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString("base64url");
}

/** A cursor is only a position; database queries always apply ownership separately. */
export function parseHistoryCursor(value: string | null): HistoryCursor | null {
  if (value === null) return null;

  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new InvalidHistoryCursorError();
    }

    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new InvalidHistoryCursorError();

    const { at, id } = cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
    return { at: new Date(at), id };
  } catch {
    throw new InvalidHistoryCursorError();
  }
}
