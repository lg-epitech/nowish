/** A small readout that follows the pointer; the value leads, the label follows. */
export function ChartTooltip({
  x,
  width,
  value,
  label,
}: {
  x: number;
  width: number;
  value: string;
  label: string;
}) {
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));

  return (
    <div className="tooltip" style={{ left }} role="presentation">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
