export type DelayUnit = "minutes" | "hours" | "days";

export function delayToMinutes(value: number, unit: DelayUnit): number {
  if (unit === "days") return Math.round(value * 24 * 60);
  if (unit === "hours") return Math.round(value * 60);
  return Math.round(value);
}

export function minutesToDelay(minutes: number): { value: number; unit: DelayUnit } {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    return { value: minutes / 1440, unit: "days" };
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    return { value: minutes / 60, unit: "hours" };
  }
  return { value: minutes, unit: "minutes" };
}
