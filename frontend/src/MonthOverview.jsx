import { useMemo, useState } from "react";
import { hasStarted, isoWeekNumber, toIsoDate } from "./format.js";

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function workdays(year, month) {
  let count = 0;
  for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
    if (d.getDay() % 6 !== 0) count += 1;
  }
  return count;
}

/** A trainer's month: courses given and planned, hours, replacements, attendance, and a bar per week. */
export default function MonthOverview({ data, user }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const { year, month } = cursor;
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const me = (data.employees || []).find((e) => String(e.id) === String(user.id)) || {};

  const stats = useMemo(() => {
    const inMonth = (data.courses || []).filter((c) => c.date.startsWith(prefix));
    const teaching = inMonth.filter((c) => String(c.trainer_id) === String(user.id) && c.status === "active");
    const given = teaching.filter(hasStarted);
    const minutesTotal = teaching.reduce((sum, c) => sum + (c.duration_minutes || 60), 0);
    const seats = teaching.reduce((sum, c) => sum + (c.capacity || 0), 0);
    const guests = teaching.reduce((sum, c) => sum + (c.booked_count || 0), 0);
    const weeks = new Map();
    for (const c of teaching) {
      const kw = isoWeekNumber(c.date);
      weeks.set(kw, (weeks.get(kw) || 0) + 1);
    }
    return {
      teaching: teaching.length,
      given: given.length,
      hours: minutesTotal / 60,
      covered: teaching.filter((c) => c.absent_trainer_id).length,
      handedOver: inMonth.filter((c) => String(c.absent_trainer_id) === String(user.id)).length,
      guests,
      fill: seats ? Math.round((guests / seats) * 100) : 0,
      weeks: [...weeks.entries()].sort((a, b) => a[0] - b[0]),
    };
  }, [data.courses, prefix, user.id]);

  const limit = Math.round(((me.max_courses_per_week || 0) * workdays(year, month)) / 5);
  const peak = Math.max(1, ...stats.weeks.map(([, n]) => n));
  const move = (step) => {
    const d = new Date(year, month + step, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const thisMonth = toIsoDate(new Date()).startsWith(prefix);

  return (
    <section className="month">
      <div className="month-head">
        <h2>Monatsübersicht</h2>
        <div className="week-toolbar" role="group" aria-label="Monat wählen">
          <button type="button" className="ghost" onClick={() => move(-1)} aria-label="Voriger Monat">
            ‹
          </button>
          <span className="month-name">
            {MONTHS[month]} {year}
          </span>
          <button type="button" className="ghost" onClick={() => move(1)} aria-label="Nächster Monat">
            ›
          </button>
        </div>
      </div>

      <div className="month-stats">
        <div>
          <strong>{stats.teaching}</strong>
          <span>
            Kurse, davon {stats.given} {thisMonth ? "schon gegeben" : "gegeben"}
          </span>
          <small>Höchstens {limit} in diesem Monat</small>
        </div>
        <div>
          <strong>{stats.hours.toLocaleString("de-DE")}</strong>
          <span>Stunden auf der Fläche</span>
        </div>
        <div>
          <strong>{stats.covered}</strong>
          <span>Vertretungen übernommen</span>
          <small>{stats.handedOver} eigene Kurse abgegeben</small>
        </div>
        <div>
          <strong>{stats.guests}</strong>
          <span>Teilnehmer</span>
          <small>{stats.fill} % der Plätze belegt</small>
        </div>
      </div>

      {stats.weeks.length > 0 ? (
        <div className="month-weeks" aria-label="Kurse pro Woche">
          {stats.weeks.map(([kw, n]) => (
            <div key={kw} className="month-week">
              <span className="month-bar" style={{ height: `${(n / peak) * 100}%` }}>
                <b>{n}</b>
              </span>
              <small>KW {kw}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="agenda-empty">In diesem Monat haben Sie keine Kurse.</p>
      )}
    </section>
  );
}
