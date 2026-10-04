export const money = (cents, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format((Number(cents) || 0) / 100);
export const compactMoney = (cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
export const today = (timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (key) => parts.find((x) => x.type === key).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};
export const thisMonth = (timezone) => today(timezone).slice(0, 7);
export const monthLabel = (value) =>
  new Date(`${value}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
export const prettyDate = (value) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "—";
export const stepMonth = (value, step) => {
  const d = new Date(`${value}-15T12:00:00`);
  d.setMonth(d.getMonth() + step);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const cents = (value) => Math.round(Number(value) * 100);
export const colors = [
  "#52705a",
  "#bc7659",
  "#c4a052",
  "#8c9080",
  "#738b92",
  "#896e61",
];
