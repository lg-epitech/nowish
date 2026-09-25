"use client";

import { useState } from "react";

import { useElementWidth } from "@/hooks/use-element-width";
import { formatMinuteOfDay } from "@/lib/format";
import type { Peak } from "@/lib/insights";
import { GRID_MINUTES } from "@/lib/insights/timing";
import { MINUTES_PER_DAY } from "@/lib/time";

import { ChartTooltip } from "./chart-tooltip";

const PLOT_HEIGHT = 120;
const RUG = 14;
const AXIS_HEIGHT = 24;
const TOP = 26;

/** Start times across a 24-hour day: a smoothed density with every session as a tick below. */
export function TimeOfDayChart({
  curve,
  starts,
  peaks,
  locale,
  ariaLabel,
}: {
  curve: number[];
  starts: number[];
  peaks: Peak[];
  locale?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const x = (minute: number) => (minute / MINUTES_PER_DAY) * width;
  const y = (value: number) => PLOT_HEIGHT - value * (PLOT_HEIGHT - TOP);
  const closed = [...curve, curve[0]];
  const line = `M${closed.map((value, index) => `${x(index * GRID_MINUTES).toFixed(1)} ${y(value).toFixed(1)}`).join("L")}`;
  const area = `${line}L${width} ${PLOT_HEIGHT}L0 ${PLOT_HEIGHT}Z`;
  const hours = [0, 3, 6, 9, 12, 15, 18, 21];
  const hoverMinute = hover === null ? null : hover * GRID_MINUTES;
  const within = (minute: number, center: number) => {
    const distance = Math.abs(minute - center) % MINUTES_PER_DAY;
    return Math.min(distance, MINUTES_PER_DAY - distance) <= 30;
  };

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={PLOT_HEIGHT + RUG + AXIS_HEIGHT}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const minute = ((event.clientX - rect.left) / rect.width) * MINUTES_PER_DAY;
          setHover(Math.min(curve.length - 1, Math.max(0, Math.round(minute / GRID_MINUTES))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {hours.slice(1).map((hour) => (
          <line key={hour} className="chart__grid" x1={x(hour * 60)} x2={x(hour * 60)} y1={TOP - 10} y2={PLOT_HEIGHT} />
        ))}
        <path className="ribbon__area" d={area} />
        <path className="ribbon__line" d={line} />
        <line className="chart__baseline" x1={0} x2={width} y1={PLOT_HEIGHT + 0.5} y2={PLOT_HEIGHT + 0.5} />

        <g className="chart__rug">
          {starts.map((minute, index) => (
            <line key={index} x1={x(minute)} x2={x(minute)} y1={PLOT_HEIGHT + 3} y2={PLOT_HEIGHT + RUG - 2} />
          ))}
        </g>

        {peaks.map((peak) => (
          <g key={peak.minute} className="chart__peak">
            <circle cx={x(peak.minute)} cy={y(curve[Math.round(peak.minute / GRID_MINUTES) % curve.length])} r={4} />
            <text
              x={Math.min(Math.max(x(peak.minute), 20), width - 20)}
              y={y(curve[Math.round(peak.minute / GRID_MINUTES) % curve.length]) - 10}
              textAnchor="middle"
            >
              {formatMinuteOfDay(peak.minute, locale)}
            </text>
          </g>
        ))}

        {hoverMinute !== null ? (
          <line className="ribbon__crosshair" x1={x(hoverMinute)} x2={x(hoverMinute)} y1={TOP - 10} y2={PLOT_HEIGHT} />
        ) : null}

        <g className="chart__axis">
          {hours.map((hour) => (
            <text
              key={hour}
              x={hour === 0 ? 0 : x(hour * 60)}
              y={PLOT_HEIGHT + RUG + 16}
              textAnchor={hour === 0 ? "start" : "middle"}
            >
              {formatMinuteOfDay(hour * 60, locale).replace(/:00(?!\d)/, "")}
            </text>
          ))}
        </g>
      </svg>

      {hoverMinute !== null ? (
        <ChartTooltip
          x={x(hoverMinute)}
          width={width}
          value={`${starts.filter((minute) => within(minute, hoverMinute)).length} started`}
          label={`within 30 min of ${formatMinuteOfDay(hoverMinute, locale)}`}
        />
      ) : null}
    </div>
  );
}
