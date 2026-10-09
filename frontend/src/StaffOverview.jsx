import { weekSlots } from "./Availability.jsx";
import { isAdmin } from "./courses.jsx";
import {
  addDays,
  formatDateLong,
  formatDateShort,
  hasStarted,
  mondayOf,
  shortStudioName,
  toIsoDate,
  todayIso,
  weekdayName,
} from "./format.js";

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

function thisWeek() {
  const monday = mondayOf(new Date());
  return [toIsoDate(monday), toIsoDate(addDays(monday, 6))];
}

function fillRate(c) {
  return c.capacity ? (c.booked_count || 0) / c.capacity : 0;
}

function CourseLine({ course, onOpen, extra }) {
  return (
    <li>
      <button className="overview-line" onClick={() => onOpen(course)}>
        <strong>{course.course_type_name}</strong>
        <span>
          {weekdayName(course.date)} {formatDateShort(course.date)}, {course.start_time} Uhr,{" "}
          {shortStudioName(course.studio_name)}
        </span>
        {extra && <em>{extra}</em>}
      </button>
    </li>
  );
}

function TrainerOverview({ data, user, onOpen }) {
  const [monday, sunday] = thisWeek();
  const me = (data.employees || []).find((e) => String(e.id) === String(user.id)) || {};
  const mine = (data.courses || []).filter(
    (c) => String(c.trainer_id) === String(user.id) && c.status !== "cancelled",
  );
  const week = mine.filter((c) => c.date >= monday && c.date <= sunday);
  const limit = me.max_courses_per_week || 0;
  const share = limit ? Math.min(100, Math.round((week.length / limit) * 100)) : 0;
  const guests = week.reduce((sum, c) => sum + (c.booked_count || 0), 0);
  const slots = [...weekSlots(data.availabilities, user.id, monday)].sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  const covering = mine
    .filter((c) => c.absent_trainer_id && !hasStarted(c))
    .slice(0, 5);

  return (
    <div className="overview-grid">
      <section className="panel overview-card">
        <h2>Ihre Woche</h2>
        <p className="overview-big">
          {week.length}
          <small> von max. {limit} Kursen</small>
        </p>
        <div className="occupancy-bar">
          <span style={{ width: `${share}%` }} />
        </div>
        <p className="overview-note">
          {guests} Teilnehmer haben Ihre Kurse diese Woche gebucht.
        </p>
      </section>

      <section className="panel overview-card">
        <h2>Ihre Verfügbarkeit diese Woche</h2>
        {slots.length ? (
          <ul className="overview-slots">
            {slots.map((a) => (
              <li key={a.id}>
                <span>{WEEKDAYS[a.weekday]}</span>
                <strong>
                  {a.start_time} bis {a.end_time}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="overview-note">Keine festen Zeiten hinterlegt.</p>
        )}
        <p className="overview-note">Ändern können Sie sie unter „Meine Zeiten“.</p>
      </section>

      <section className="panel overview-card">
        <h2>Ihre Vertretungen</h2>
        {covering.length ? (
          <ul className="overview-list">
            {covering.map((c) => (
              <CourseLine key={c.id} course={c} onOpen={onOpen} extra={`für ${c.absent_trainer_name}`} />
            ))}
          </ul>
        ) : (
          <p className="overview-note">Sie vertreten gerade niemanden.</p>
        )}
      </section>
    </div>
  );
}

function AdminOverview({ data, onOpen }) {
  const today = todayIso();
  const [monday, sunday] = thisWeek();
  const sick = (data.employees || []).filter((e) => e.status === "unavailable");
  const open = (data.courses || [])
    .filter((c) => c.status === "needs_replacement" && c.date >= today)
    .slice(0, 5);
  const ratingByType = new Map();
  for (const c of data.courses || []) {
    if (!c.rating_count) continue;
    const entry = ratingByType.get(c.course_type_name) || { sum: 0, count: 0 };
    entry.sum += c.avg_rating * c.rating_count;
    entry.count += c.rating_count;
    ratingByType.set(c.course_type_name, entry);
  }
  const ratings = [...ratingByType.entries()]
    .map(([name, { sum, count }]) => ({ name, avg: sum / count, count }))
    .sort((a, b) => b.avg - a.avg);
  const popular = (data.courses || [])
    .filter((c) => c.status === "active" && c.date >= monday && c.date <= sunday && c.booked_count)
    .sort((a, b) => fillRate(b) - fillRate(a))
    .slice(0, 5);

  return (
    <div className="overview-grid">
      <section className="panel overview-card">
        <h2>Krankgemeldet</h2>
        {sick.length ? (
          <ul className="overview-slots">
            {sick.map((e) => (
              <li key={e.id}>
                <span>{e.name}</span>
                <strong>{e.unavailable_to ? `bis ${formatDateLong(e.unavailable_to)}` : "ohne Enddatum"}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="overview-note">Alle Mitarbeiter sind verfügbar.</p>
        )}
      </section>

      <section className="panel overview-card">
        <h2>Ohne Trainer</h2>
        {open.length ? (
          <ul className="overview-list">
            {open.map((c) => (
              <CourseLine key={c.id} course={c} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <p className="overview-note">Jeder kommende Kurs hat einen Trainer.</p>
        )}
      </section>

      <section className="panel overview-card">
        <h2>Am vollsten diese Woche</h2>
        {popular.length ? (
          <ul className="overview-list">
            {popular.map((c) => (
              <CourseLine
                key={c.id}
                course={c}
                onOpen={onOpen}
                extra={`${c.booked_count} von ${c.capacity} Plätzen`}
              />
            ))}
          </ul>
        ) : (
          <p className="overview-note">Diese Woche gibt es noch keine Buchungen.</p>
        )}
      </section>

      <section className="panel overview-card">
        <h2>Bewertungen nach Kursart</h2>
        {ratings.length ? (
          <ul className="overview-slots">
            {ratings.map((r) => (
              <li key={r.name}>
                <span>{r.name}</span>
                <strong>
                  ★ {r.avg.toLocaleString("de-DE", { maximumFractionDigits: 1 })}{" "}
                  <small className="muted">({r.count})</small>
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="overview-note">Noch keine Bewertungen von Mitgliedern.</p>
        )}
      </section>
    </div>
  );
}

/** Panels under the staff timetable. Clicking a course opens the same details window as the plan. */
export default function StaffOverview({ data, user, onOpen }) {
  return isAdmin(user) ? (
    <AdminOverview data={data} onOpen={onOpen} />
  ) : (
    <TrainerOverview data={data} user={user} onOpen={onOpen} />
  );
}
