"use client";

import { useState } from "react";

import { useElementWidth } from "@/hooks/use-element-width";

import { ChartTooltip } from "./chart-tooltip";

export interface Column {
  key: string;
  value: number;
  /** Tooltip label, e.g. the date. */
  label: string;
  /** The one column the story is about. */
  highlight?: boolean;
}

const PLOT_HEIGHT = 140;
const AXIS_HEIGHT = 24;
const TOP = 18;
const MAX_BAR = 24;
const GAP = 2;
/** Room to the right of the plot for the reference line's label. */
const REFERENCE_GUTTER = 88;

/** Rounded data-end, square at the baseline. */
function columnPath(x: number, y: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height);
  return `M${x} ${y + height}V${y + radius}Q${x} ${y} ${x + radius} ${y}H${x + width - radius}Q${x + width} ${y} ${x + width} ${y + radius}V${y + height}Z`;
}

export function ColumnChart({
  columns,
  format,
  reference,
  axisLabels,
  ariaLabel,
}: {
  columns: Column[];
  format: (value: number) => string;
  reference?: { value: number; label: string };
  /** Labels under the first and last column. */
  axisLabels?: [string, string];
  ariaLabel: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1e-9, ...columns.map((column) => column.value), reference?.value ?? 0);
  const plotWidth = reference ? Math.max(120, width - REFERENCE_GUTTER) : width;
  const slot = columns.length > 0 ? plotWidth / columns.length : plotWidth;
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot - GAP));
  const scale = (value: number) => ((PLOT_HEIGHT - TOP) * value) / max;
  const hovered = hover === null ? null : columns[hover];

  return (
    <div className="chart" ref={ref}>
      <svg
        width={width}
        height={PLOT_HEIGHT + AXIS_HEIGHT}
        role="img"
        aria-label={ariaLabel}
        onPointerLeave={() => setHover(null)}
      >
        <line className="chart__baseline" x1={0} x2={plotWidth} y1={PLOT_HEIGHT + 0.5} y2={PLOT_HEIGHT + 0.5} />

        {columns.map((column, index) => {
          const height = Math.max(1, scale(column.value));
          const x = index * slot + (slot - barWidth) / 2;

          return (
            <g key={column.key}>
              <path
                className={column.highlight ? "chart__bar chart__bar--accent" : "chart__bar"}
                data-hover={hover === index || undefined}
                d={columnPath(x, PLOT_HEIGHT - height, barWidth, height)}
              />
              <rect
                className="chart__hit"
                x={index * slot}
                y={0}
                width={slot}
                height={PLOT_HEIGHT}
                onPointerEnter={() => setHover(index)}
              />
            </g>
          );
        })}

        {reference ? (
          <g className="chart__reference">
            <line
              x1={0}
              x2={plotWidth + 4}
              y1={Math.round(PLOT_HEIGHT - scale(reference.value)) + 0.5}
              y2={Math.round(PLOT_HEIGHT - scale(reference.value)) + 0.5}
            />
            <text x={plotWidth + 10} y={PLOT_HEIGHT - scale(reference.value) + 4}>
              {reference.label}
            </text>
          </g>
        ) : null}

        {axisLabels ? (
          <g className="chart__axis">
            <text x={0} y={PLOT_HEIGHT + 17}>
              {axisLabels[0]}
            </text>
            <text x={plotWidth} y={PLOT_HEIGHT + 17} textAnchor="end">
              {axisLabels[1]}
            </text>
          </g>
        ) : null}
      </svg>

      {hovered && hover !== null ? (
        <ChartTooltip x={hover * slot + slot / 2} width={plotWidth} value={format(hovered.value)} label={hovered.label} />
      ) : null}
    </div>
  );
}
