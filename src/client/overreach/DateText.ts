import { dayOfYear, eraOf, yearAt } from "../../core/overreach/Calendar";
import { translateText } from "../Utils";

/** The in-game date and era for a game that started in `start`, `ticks` ago. */
export function dateText(
  start: number,
  ticks: number,
): { text: string; era: string; year: number } {
  const year = yearAt(start, ticks);
  const { month, day } = dayOfYear(ticks);
  // Date.UTC keeps years below 100 and the time zone out of it.
  const date = new Date(Date.UTC(2000, month, day));
  date.setUTCFullYear(year);
  return {
    year,
    text: date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    era: translateText(`calendar.era_${eraOf(year)}`),
  };
}
