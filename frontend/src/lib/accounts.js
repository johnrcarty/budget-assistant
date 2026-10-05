import { prettyDate } from "./format.js";

export const isDebt = (account) => ["loan", "credit"].includes(account?.kind);
export const netBalance = (account) =>
  isDebt(account)
    ? -Math.abs(account.balance_cents || 0)
    : account.balance_cents || 0;
export const debtLabels = {
  mortgage: "Mortgage",
  auto: "Auto loan",
  student: "Student loan",
  personal: "Personal loan",
  credit_card: "Credit card",
  line_of_credit: "Line of credit",
  other: "Other debt",
};
export const cadenceLabels = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice monthly",
  monthly: "Monthly",
};
export function scheduleLabel(schedule) {
  if (!schedule) return "No payment schedule";
  if (!schedule.active) return "Schedule stopped";
  const day = (value) => (value === "last" ? "last day" : `day ${value}`);
  if (schedule.cadence === "semimonthly")
    return `${cadenceLabels[schedule.cadence]} · ${day(schedule.day1)} & ${day(schedule.day2)}`;
  if (schedule.cadence === "monthly")
    return `${cadenceLabels[schedule.cadence]} · ${day(schedule.day1 || Number(schedule.anchor_date?.slice(-2)))}`;
  return `${cadenceLabels[schedule.cadence]} · from ${prettyDate(schedule.anchor_date)}`;
}
