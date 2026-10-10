export function ScoreBar({ value }: { value: number }) {
  const color =
    value >= 80 ? 'bg-mirqab-success' : value >= 50 ? 'bg-mirqab-warning' : 'bg-mirqab-danger';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
