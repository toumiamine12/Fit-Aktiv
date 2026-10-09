import { useMemo } from "react";
import { addDays, hasStarted, mondayOf, toIsoDate } from "./format.js";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** Weeks in a row (up to this week) with at least one course. This week still counts if it is not over. */
function streak(dates) {
  const weeks = new Set(dates.map((d) => toIsoDate(mondayOf(new Date(`${d}T12:00:00`)))));
  let monday = mondayOf(new Date());
  if (!weeks.has(toIsoDate(monday))) monday = addDays(monday, -7);
  let count = 0;
  while (weeks.has(toIsoDate(monday))) {
    count += 1;
    monday = addDays(monday, -7);
  }
  return count;
}

/** A member's training history: attended courses, streak, favourite course type and a six-month chart. */
export default function MemberTraining({ data }) {
  const stats = useMemo(() => {
    const booked = new Set(
      (data.my_bookings || []).filter((b) => b.status !== "waiting").map((b) => b.course_id),
    );
    const attended = (data.courses || []).filter(
      (c) => booked.has(c.id) && c.status === "active" && hasStarted(c),
    );
    const now = new Date();
    const thisMonth = toIsoDate(now).slice(0, 7);
    const byType = new Map();
    for (const c of attended) byType.set(c.course_type_name, (byType.get(c.course_type_name) || 0) + 1);
    const types = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const key = toIsoDate(d).slice(0, 7);
      return { key, label: MONTHS[d.getMonth()], count: attended.filter((c) => c.date.startsWith(key)).length };
    });
    const ratings = data.me?.ratings || [];
    return {
      total: attended.length,
      month: attended.filter((c) => c.date.startsWith(thisMonth)).length,
      minutes: attended.reduce((sum, c) => sum + (c.duration_minutes || 60), 0),
      streak: streak(attended.map((c) => c.date)),
      favorite: types[0]?.[0],
      types,
      months,
      avgRating: ratings.length ? ratings.reduce((s, r) => s + r.stars, 0) / ratings.length : null,
      ratingCount: ratings.length,
    };
  }, [data.my_bookings, data.courses, data.me]);

  const peak = Math.max(1, ...stats.months.map((m) => m.count));
  const typePeak = Math.max(1, ...stats.types.map(([, n]) => n));

  return (
    <section className="training">
      <div className="month-stats">
        <div>
          <strong>{stats.total}</strong>
          <span>Kurse besucht</span>
          <small>{stats.month} davon in diesem Monat</small>
        </div>
        <div>
          <strong>{stats.streak}</strong>
          <span>{stats.streak === 1 ? "Woche" : "Wochen"} in Folge</span>
          <small>{stats.streak ? "Weiter so!" : "Buchen Sie einen Kurs und starten Sie Ihre Serie."}</small>
        </div>
        <div>
          <strong>{Math.round(stats.minutes / 60).toLocaleString("de-DE")}</strong>
          <span>Stunden trainiert</span>
          <small>{stats.minutes.toLocaleString("de-DE")} Minuten insgesamt</small>
        </div>
        <div>
          <strong className="training-favorite">{stats.favorite || "noch offen"}</strong>
          <span>Ihr Lieblingskurs</span>
          <small>
            {stats.ratingCount
              ? `Ihre Bewertungen: ★ ${stats.avgRating.toLocaleString("de-DE", { maximumFractionDigits: 1 })} (${stats.ratingCount})`
              : "Bewerten Sie vergangene Kurse unter „Meine Kurse“."}
          </small>
        </div>
      </div>

      <div className="training-grid">
        <div className="panel">
          <h2>Die letzten sechs Monate</h2>
          <div className="month-weeks training-chart" aria-label="Besuchte Kurse pro Monat">
            {stats.months.map((m) => (
              <div key={m.key} className="month-week">
                {m.count > 0 && (
                  <span className="month-bar" style={{ height: `${(m.count / peak) * 100}%` }}>
                    <b>{m.count}</b>
                  </span>
                )}
                <small>{m.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Nach Kursart</h2>
          {stats.types.length ? (
            <ul className="training-types">
              {stats.types.map(([name, n]) => (
                <li key={name}>
                  <span>{name}</span>
                  <div className="occupancy-bar">
                    <span style={{ width: `${(n / typePeak) * 100}%` }} />
                  </div>
                  <strong>{n}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Sobald Sie Ihren ersten Kurs besucht haben, sehen Sie hier Ihre Verteilung.</p>
          )}
        </div>
      </div>
    </section>
  );
}
