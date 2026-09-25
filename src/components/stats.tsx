"use client";

import type { ReactNode } from "react";

import { ColumnChart } from "@/components/charts/column-chart";
import { Heatmap } from "@/components/charts/heatmap";
import { TableView } from "@/components/charts/table-view";
import { TimeOfDayChart } from "@/components/charts/time-of-day-chart";
import {
  formatDelta,
  formatGap,
  formatMinuteOfDay,
  formatMinuteOfDayRange,
  formatMinuteRange,
  formatMinutes,
  formatWeekday,
  type FormatOptions,
} from "@/lib/format";
import type { Insights } from "@/lib/insights";

function Figure({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="figure">
      <dt>{label}</dt>
      <dd className="figure__value">{value}</dd>
      {note ? <dd className="figure__note">{note}</dd> : null}
    </div>
  );
}

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={`${id}-title`}>
      <header className="section__head">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{lede}</p>
      </header>
      {children}
    </section>
  );
}

function shortDate(ms: number, options: FormatOptions) {
  return new Intl.DateTimeFormat(options.locale, { month: "short", day: "numeric", timeZone: options.timeZone }).format(ms);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function TimeSpentSection({
  insights,
  noun,
  options,
}: {
  insights: Insights;
  noun: string;
  options: FormatOptions;
}) {
  const spent = insights.timeSpent;
  const count = insights.sessionCount;

  if (count === 0) {
    return (
      <Section id="spent" title="Time actually spent" lede={`Nothing logged yet. Your first ${noun} shows up here.`}>
        <dl className="figures">
          <Figure label="Your guess" value={formatMinutes(insights.prior.typicalMinutes)} note="until real sessions replace it" />
        </dl>
      </Section>
    );
  }

  const usual = spent.typicalMinutes ?? insights.prior.typicalMinutes;
  const trend = spent.trend;

  return (
    <Section
      id="spent"
      title="Time actually spent"
      lede={`From ${count} logged ${count === 1 ? "session" : "sessions"}. Recent ones count more.`}
    >
      <dl className="figures">
        <Figure label="Usually" value={formatMinutes(usual)} note="median, weighted to recent" />
        {spent.rangeMinutes && count >= 4 ? (
          <Figure label="Most sessions" value={formatMinuteRange(...spent.rangeMinutes)} note="the middle half" />
        ) : null}
        {spent.last ? (
          <Figure
            label="Last time"
            value={formatMinutes(spent.last.minutes)}
            note={spent.last.deltaMinutes === null ? "your first one" : formatDelta(spent.last.deltaMinutes)}
          />
        ) : null}
        {spent.perWeekMinutes !== null ? (
          <Figure label="Per week" value={formatMinutes(spent.perWeekMinutes)} note="over the last 8 weeks" />
        ) : null}
      </dl>

      <figure className="chart-block">
        <figcaption className="chart-block__title">Last {spent.recent.length} sessions, latest in blue</figcaption>
        <ColumnChart
          ariaLabel={`Minutes spent in the last ${spent.recent.length} sessions`}
          columns={spent.recent.map((session, index) => ({
            key: session.id,
            value: session.minutes,
            label: shortDate(session.start, options),
            highlight: index === spent.recent.length - 1,
          }))}
          format={(value) => formatMinutes(value)}
          reference={{ value: usual, label: `usual ${formatMinutes(usual)}` }}
          axisLabels={
            spent.recent.length > 1
              ? [shortDate(spent.recent[0].start, options), "latest"]
              : undefined
          }
        />
        <TableView
          caption="Minutes spent per session"
          columns={["Date", "Minutes"]}
          rows={[...spent.recent].reverse().map((session) => [shortDate(session.start, options), formatMinutes(session.minutes)])}
        />
      </figure>

      <div className="notes">
        {trend ? (
          <p>
            Over the last 30 days you’ve spent{" "}
            <strong>
              {Math.abs(trend.deltaRatio) < 0.03
                ? "about the same"
                : `${percent(Math.abs(trend.deltaRatio))} ${trend.deltaRatio > 0 ? "longer" : "less"}`}
            </strong>{" "}
            per session than the month before ({formatMinutes(trend.recentMinutes)} against {formatMinutes(trend.previousMinutes)}).
          </p>
        ) : null}
        {spent.byDaypart.length > 1 ? (
          <dl className="inline-stats">
            {spent.byDaypart.map((part) => (
              <div key={part.id}>
                <dt>{part.label}</dt>
                <dd>
                  {formatMinutes(part.medianMinutes)} <span>from {part.count}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {spent.shortestMinutes !== null && spent.longestMinutes !== null && count >= 3 ? (
          <p>
            Shortest {formatMinutes(spent.shortestMinutes)}, longest {formatMinutes(spent.longestMinutes)}, and{" "}
            {formatMinutes(spent.totalMinutes)} in total.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

export function TimingSection({ insights, options }: { insights: Insights; options: FormatOptions }) {
  const { timing, sessionCount } = insights;

  if (sessionCount < 2) return null;

  const [first, second] = timing.peaks;
  const best = timing.feel.best;
  const blockCounts = timing.heatmap.reduce<number[]>(
    (totals, row) => totals.map((total, block) => total + row[block]),
    new Array<number>(12).fill(0),
  );

  return (
    <Section
      id="timing"
      title="When you usually start"
      lede={`Start times across the day, smoothed over about ±${timing.bandwidthMinutes} minutes.`}
    >
      <dl className="figures">
        {first ? (
          <Figure
            label="Usual time"
            value={formatMinuteOfDay(first.minute, options.locale)}
            note={`${percent(first.share)} of sessions start near it`}
          />
        ) : null}
        {second ? (
          <Figure
            label="Also"
            value={formatMinuteOfDay(second.minute, options.locale)}
            note={`${percent(second.share)} of sessions`}
          />
        ) : null}
        {timing.spreadMinutes !== null ? (
          <Figure
            label="Drift"
            value={`±${Math.round(timing.spreadMinutes)} min`}
            note="typical distance from a usual time"
          />
        ) : null}
        <Figure
          label="Best-rated hours"
          value={
            best
              ? formatMinuteOfDayRange(best.fromMinute, best.toMinute, options.locale)
              : "Not yet"
          }
          note={
            best
              ? `rated good ${percent(best.goodShare)} of ${best.count} times`
              : `rate ${Math.max(1, 5 - timing.feel.rated)} more to find out`
          }
        />
      </dl>

      <figure className="chart-block">
        <figcaption className="chart-block__title">Start times, each tick one session</figcaption>
        <TimeOfDayChart
          curve={timing.curve}
          starts={insights.sessions.map((session) => session.localMinute)}
          peaks={timing.peaks}
          locale={options.locale}
          ariaLabel="How start times spread across the day"
        />
        <TableView
          caption="Sessions per two-hour block"
          columns={["Hours", "Sessions"]}
          rows={blockCounts.map((count, block) => [
            formatMinuteOfDayRange(block * 120, (block + 1) * 120, options.locale),
            count,
          ])}
        />
      </figure>

      <figure className="chart-block">
        <figcaption className="chart-block__title">By weekday</figcaption>
        <Heatmap counts={timing.heatmap} locale={options.locale} />
        <TableView
          caption="Sessions per weekday"
          columns={["Weekday", "Sessions", "Share"]}
          rows={timing.weekdays.map((day) => [
            formatWeekday(day.weekday, "long", options.locale),
            day.count,
            percent(day.share),
          ])}
        />
      </figure>
    </Section>
  );
}

export function RhythmSection({ insights, options }: { insights: Insights; options: FormatOptions }) {
  const { rhythm, sessionCount, prior } = insights;

  if (sessionCount === 0) return null;

  const daily = (rhythm.medianGapHours ?? prior.cadenceHours) <= 36;
  const weekLabel = (weekStart: string) =>
    new Intl.DateTimeFormat(options.locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(
      Date.parse(`${weekStart}T00:00:00Z`),
    );

  return (
    <Section id="rhythm" title="How often" lede="Gaps are measured start to start.">
      <dl className="figures">
        <Figure
          label="Usual gap"
          value={formatGap(rhythm.medianGapHours ?? prior.cadenceHours)}
          note={
            rhythm.gapRangeHours && rhythm.gapCount >= 4
              ? `most between ${formatGap(rhythm.gapRangeHours[0])} and ${formatGap(rhythm.gapRangeHours[1])}`
              : rhythm.medianGapHours === null
                ? "your starting guess"
                : `from ${rhythm.gapCount} gaps`
          }
        />
        {rhythm.elapsedHours !== null ? (
          <Figure label="Since the last one" value={formatGap(rhythm.elapsedHours)} />
        ) : null}
        {rhythm.perWeek !== null ? (
          <Figure
            label="Per week"
            value={rhythm.perWeek.toFixed(rhythm.perWeek < 10 ? 1 : 0)}
            note={`${rhythm.sessionsLast30Days} in the last 30 days`}
          />
        ) : null}
        {daily ? (
          <Figure
            label="Streak"
            value={`${rhythm.currentStreakDays} ${rhythm.currentStreakDays === 1 ? "day" : "days"}`}
            note={`longest ${rhythm.longestStreakDays}`}
          />
        ) : null}
      </dl>

      <figure className="chart-block">
        <figcaption className="chart-block__title">Sessions per week, this week in blue</figcaption>
        <ColumnChart
          ariaLabel="Sessions per week over the last 12 weeks"
          columns={rhythm.weeks.map((week, index) => ({
            key: week.weekStart,
            value: week.count,
            label: `week of ${weekLabel(week.weekStart)}`,
            highlight: index === rhythm.weeks.length - 1,
          }))}
          format={(value) => (value === 1 ? "1 session" : `${value} sessions`)}
          axisLabels={[weekLabel(rhythm.weeks[0].weekStart), "this week"]}
        />
        <TableView
          caption="Sessions per week"
          columns={["Week of", "Sessions"]}
          rows={[...rhythm.weeks].reverse().map((week) => [weekLabel(week.weekStart), week.count])}
        />
      </figure>
    </Section>
  );
}
