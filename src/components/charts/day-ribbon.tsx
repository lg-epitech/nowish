"use client";

import { useMemo, useState } from "react";

import { useElementWidth } from "@/hooks/use-element-width";
import {
  formatHourLabel,
  formatMoment,
  formatWeekday,
  KIND_LABELS,
  type FormatOptions,
} from "@/lib/format";
import { indexAt, type Forecast, type Verdict } from "@/lib/insights";
import { MS_PER_MINUTE } from "@/lib/time";

import { ChartTooltip } from "./chart-tooltip";
import { TableView } from "./table-view";

const PLOT_HEIGHT = 128;
const AXIS_HEIGHT = 26;
const TOP = 28;

interface Tick {
  x: number;
  label: string;
}

function ticksFor(forecast: Forecast, width: number, options: FormatOptions): Tick[] {
  const { points, horizonSteps, stepMinutes } = forecast;
  const span = Math.max(1, points[horizonSteps].at - forecast.from);
  const daily = stepMinutes <= 5;
  const every = width < 560 ? 6 : 3;
  const ticks: Tick[] = [];

  for (let index = 1; index <= horizonSteps; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const hour = Math.floor(point.localMinute / 60);
    if (hour === Math.floor(previous.localMinute / 60)) continue;

    const boundary = point.at - (point.localMinute % 60) * MS_PER_MINUTE - (point.at % MS_PER_MINUTE);
    const x = ((boundary - forecast.from) / span) * width;

    if (daily && hour % every === 0) {
      ticks.push({
        x,
        label: hour === 0 ? formatWeekday(point.localWeekday, "short", options.locale) : formatHourLabel(boundary, options),
      });
    } else if (!daily && hour === 0) {
      ticks.push({ x, label: formatWeekday(point.localWeekday, "short", options.locale) });
    }
  }

  return ticks.filter((tick) => tick.x > 24 && tick.x < width - 16);
}

/**
 * How good each moment of the coming day (or week) looks, with the checked
 * moment as a needle. The overlaid range input makes it draggable and
 * keyboard-accessible without custom key handling.
 */
export function DayRibbon({
  forecast,
  selected,
  verdict,
  verdictAt,
  onSelect,
  options,
  noun,
}: {
  forecast: Forecast;
  selected: number;
  verdict: Verdict;
  verdictAt: (index: number) => Verdict;
  onSelect: (index: number) => void;
  options: FormatOptions;
  noun: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { horizonSteps, stepMinutes } = forecast;
  const shown = forecast.points.slice(0, horizonSteps + 1);
  const max = Math.max(0.05, ...shown.map((point) => point.score));
  const span = Math.max(1, shown[shown.length - 1].at - forecast.from);
  const toX = (ms: number) => Math.min(width, Math.max(0, ((ms - forecast.from) / span) * width));
  const x = (index: number) => toX(forecast.points[index].at);
  const y = (score: number) => PLOT_HEIGHT - (score / max) * (PLOT_HEIGHT - TOP);

  const line = `M${shown.map((point, index) => `${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`).join("L")}`;
  const area = `${line}L${width} ${PLOT_HEIGHT}L0 ${PLOT_HEIGHT}Z`;

  const ticks = useMemo(() => ticksFor(forecast, width, options), [forecast, width, options]);
  const goodWindow = verdict.window;
  const hovered = hover === null ? null : verdictAt(hover);
  const selectedPoint = forecast.points[selected];
  const describe = (item: Verdict) =>
    `${formatMoment(item.at, forecast.from, options)}: ${KIND_LABELS[item.kind].toLowerCase()}`;

  const tableRows = useMemo(() => {
    // Hourly rows for a day, six-hourly rows for a week.
    const every = 12;
    const rows: string[][] = [];
    for (let index = 0; index <= horizonSteps; index += every) {
      const item = verdictAt(index);
      rows.push([
        formatMoment(item.at, forecast.from, options),
        KIND_LABELS[item.kind],
        `${Math.round(item.point.readiness * 100)}%`,
        `${Math.round(item.point.habit * 100)}%`,
      ]);
    }
    return rows;
  }, [forecast, horizonSteps, verdictAt, options]);

  return (
    <figure className="ribbon">
      <div className="ribbon__plot" ref={ref}>
        <svg width={width} height={PLOT_HEIGHT + AXIS_HEIGHT} aria-hidden="true">
          {goodWindow ? (
            <rect
              className="ribbon__window"
              x={toX(goodWindow.from)}
              y={TOP - 12}
              width={Math.max(3, toX(goodWindow.to) - toX(goodWindow.from))}
              height={PLOT_HEIGHT - TOP + 12}
              rx={4}
            />
          ) : null}
          <path className="ribbon__area" d={area} />
          <path className="ribbon__line" d={line} />
          <line className="chart__baseline" x1={0} x2={width} y1={PLOT_HEIGHT + 0.5} y2={PLOT_HEIGHT + 0.5} />

          {ticks.map((tick) => (
            <g key={`${tick.x}-${tick.label}`} className="chart__axis">
              <line x1={tick.x} x2={tick.x} y1={PLOT_HEIGHT} y2={PLOT_HEIGHT + 4} />
              <text x={tick.x} y={PLOT_HEIGHT + 19} textAnchor="middle">
                {tick.label}
              </text>
            </g>
          ))}

          {hover !== null && hover !== selected ? (
            <line className="ribbon__crosshair" x1={x(hover)} x2={x(hover)} y1={TOP - 12} y2={PLOT_HEIGHT} />
          ) : null}

          <g className="ribbon__needle">
            <line x1={x(selected)} x2={x(selected)} y1={10} y2={PLOT_HEIGHT} />
            <circle cx={x(selected)} cy={y(selectedPoint.score)} r={5} />
            <text
              x={Math.min(Math.max(x(selected), 4), width - 4)}
              y={8}
              textAnchor={x(selected) < 40 ? "start" : x(selected) > width - 40 ? "end" : "middle"}
            >
              {selected === 0 ? "Now" : formatMoment(selectedPoint.at, forecast.from, options)}
            </text>
          </g>
        </svg>

        <input
          className="ribbon__input"
          type="range"
          min={0}
          max={horizonSteps}
          step={1}
          value={selected}
          aria-label={`Check another time for ${noun}`}
          aria-valuetext={describe(verdictAt(selected))}
          onChange={(event) => onSelect(Number(event.target.value))}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            setHover(indexAt(forecast, forecast.from + ratio * span));
          }}
          onPointerLeave={() => setHover(null)}
        />

        {hovered && hover !== null ? (
          <ChartTooltip
            x={x(hover)}
            width={width}
            value={KIND_LABELS[hovered.kind]}
            label={formatMoment(hovered.at, forecast.from, options)}
          />
        ) : null}
      </div>

      <figcaption className="ribbon__caption">
        {stepMinutes <= 5 ? "The next 24 hours" : "The next 7 days"}. Higher means a better moment; the shaded band is the
        good window. Drag across it to check another time.
      </figcaption>

      <TableView
        caption={`How good each moment looks for ${noun}`}
        columns={["Time", "Verdict", "Ready", "Usual time"]}
        rows={tableRows}
      />
    </figure>
  );
}
