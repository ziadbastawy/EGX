/** Next EGX cash session (Sun–Thu, Africa/Cairo). From 15:00 Cairo, roll to the next trading day. */

function cairoParts(from = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map = Object.fromEntries(
    fmt.formatToParts(from).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    weekday: dayMap[map.weekday] ?? 0,
  };
}

function isEgxTradingDay(weekday) {
  return weekday >= 0 && weekday <= 4;
}

function sessionAnchor(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function getNextEgxSessionDate(from = new Date()) {
  const p = cairoParts(from);
  if (isEgxTradingDay(p.weekday) && p.hour < 15) return sessionAnchor(p);

  let cursor = sessionAnchor(p);
  for (let i = 0; i < 8; i++) {
    cursor = new Date(cursor.getTime() + 86400000);
    if (isEgxTradingDay(cairoParts(cursor).weekday)) return cursor;
  }
  return cursor;
}

export function formatSessionDay(date, locale = "ar-EG-u-nu-latn") {
  return date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Cairo",
  });
}
