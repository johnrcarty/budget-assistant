import { prettyDate } from "./format.js";

export const isDebt = (account) => ["loan", "credit"].includes(account?.kind);
export const isPaidOffLoan = (account) =>
  account?.kind === "loan" && account.payoff_status === "paid_off";
export const isCountedAccount = (account) => account.net_worth_included !== false;
export const accountKinds = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  loan: "Loan",
  investment: "Investment",
  property: "Property",
  vehicle: "Vehicle",
  other: "Other account",
};
export const netBalance = (account) =>
  !isCountedAccount(account)
    ? 0
    : isDebt(account)
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
