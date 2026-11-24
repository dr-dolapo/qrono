import NumberFlow, { NumberFlowGroup } from "@number-flow/react";

const TWO = { minimumIntegerDigits: 2 } as const;
// Minutes and seconds tens digit only goes to 5, so it rolls the short way round.
const SIXTY = { 1: { max: 5 } } as const;

/** "12:34" or "1:02:03" where only the digits that change roll over (NumberFlow). */
export function Countdown({ ms }: { ms: number }) {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // Counting down normally; counting up once over time.
  const trend = ms < 0 ? 1 : -1;
  return (
    <NumberFlowGroup>
      <span className="countdown" aria-label={`${h ? `${h} hours ` : ""}${m} minutes ${s} seconds`}>
        {h > 0 && <NumberFlow value={h} trend={trend} />}
        <NumberFlow value={m} prefix={h > 0 ? ":" : undefined} trend={trend} format={TWO} digits={h > 0 ? SIXTY : undefined} />
        <NumberFlow value={s} prefix=":" trend={trend} format={TWO} digits={SIXTY} />
      </span>
    </NumberFlowGroup>
  );
}
