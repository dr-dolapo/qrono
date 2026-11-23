/**
 * The lengths an agenda item can have (the editor's Duration dropdown):
 * every minute from 1 to 15, then every 5 minutes to 60, then every 15 minutes to 120.
 */
export const AGENDA_DURATIONS: readonly number[] = [
  ...Array.from({ length: 15 }, (_, i) => i + 1),
  ...Array.from({ length: 9 }, (_, i) => 20 + i * 5),
  75,
  90,
  105,
  120,
];

export const isAgendaDuration = (minutes: number) => AGENDA_DURATIONS.includes(minutes);
