"use client";

import { useState } from "react";

import { formatMinuteOfDay, formatMinuteOfDayRange, formatWeekday } from "@/lib/format";

const STEPS = 6;

/** Sessions by weekday and two-hour block, one sequential hue. */
export function Heatmap({ counts, locale }: { counts: number[][]; locale?: string }) {
  const [hover, setHover] = useState<{ day: number; block: number } | null>(null);
  const max = Math.max(1, ...counts.flat());
  const step = (count: number) => (count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * STEPS)));
  const hovered = hover ? counts[hover.day][hover.block] : null;
  const blockLabel = (block: number) => formatMinuteOfDayRange(block * 120, (block + 1) * 120, locale);

  return (
    <div className="heatmap" onPointerLeave={() => setHover(null)}>
      <div className="heatmap__grid" role="img" aria-label="Sessions by weekday and time of day">
        {counts.map((row, day) => (
          <div className="heatmap__row" key={day}>
            <span className="heatmap__day">{formatWeekday(day + 1, "short", locale)}</span>
            {row.map((count, block) => (
              <span
                key={block}
                className="heatmap__cell"
                data-step={step(count)}
                data-hover={hover?.day === day && hover.block === block ? "" : undefined}
                onPointerEnter={() => setHover({ day, block })}
              />
            ))}
          </div>
        ))}
        <div className="heatmap__row heatmap__row--axis" aria-hidden="true">
          <span className="heatmap__day" />
          {Array.from({ length: 12 }, (_, block) => (
            <span key={block} className="heatmap__tick">
              {block % 3 === 0 ? formatMinuteOfDay(block * 120, locale).replace(/:00(?!\d)/, "") : ""}
            </span>
          ))}
        </div>
      </div>
      <p className="heatmap__readout" aria-live="polite">
        {hover && hovered !== null ? (
          <>
            <strong>{hovered === 1 ? "1 session" : `${hovered} sessions`}</strong>{" "}
            <span>
              {formatWeekday(hover.day + 1, "long", locale)}s, {blockLabel(hover.block)}
            </span>
          </>
        ) : (
          <span>Darker means more sessions. Point at a cell for the count.</span>
        )}
      </p>
    </div>
  );
}
