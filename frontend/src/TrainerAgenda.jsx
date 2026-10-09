import { useEffect, useMemo, useState } from "react";
import { downloadCoursesIcs } from "./calendar.js";
import StaffCourseDialog from "./CourseDialog.jsx";
import { courseColorClass, isOwnAbsentCourse } from "./courses.jsx";
import MonthOverview from "./MonthOverview.jsx";
import {
  addDays,
  formatDateShort,
  shortStudioName,
  toIsoDate,
  toLocalDate,
  weekdayName,
} from "./format.js";

const DAYS_AHEAD = 14;

function startOf(course) {
  const d = toLocalDate(course.date);
  const [h, m] = course.start_time.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function countdown(course, now) {
  const start = startOf(course);
  const end = new Date(start.getTime() + (course.duration_minutes || 60) * 60000);
  if (now >= start && now < end) return "läuft gerade";
  const minutes = Math.round((start - now) / 60000);
  if (minutes < 60) return `in ${minutes} Min.`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    return `in ${h} Std. ${minutes % 60} Min.`;
  }
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? "morgen" : `in ${days} Tagen`;
}

function endTime(course) {
  const end = new Date(startOf(course).getTime() + (course.duration_minutes || 60) * 60000);
  return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
}

function dayLabel(iso, today) {
  if (iso === today) return "Heute";
  if (iso === toIsoDate(addDays(toLocalDate(today), 1))) return "Morgen";
  return weekdayName(iso, true);
}

function Occupancy({ course }) {
  const capacity = course.capacity || 0;
  const booked = course.booked_count || 0;
  const share = capacity ? Math.min(100, Math.round((booked / capacity) * 100)) : 0;
  return (
    <div className="occupancy">
      <div className="occupancy-bar">
        <span style={{ width: `${share}%` }} />
      </div>
      <small>
        {booked} von {capacity} Plätzen gebucht
      </small>
    </div>
  );
}

function CourseNote({ course, user }) {
  if (isOwnAbsentCourse(course, user)) {
    return (
      <span className="agenda-note sick">
        Sie sind krankgemeldet{course.trainer_name ? `, ${course.trainer_name} übernimmt` : ""}
      </span>
    );
  }
  if (course.status === "cancelled") return <span className="agenda-note sick">Fällt aus</span>;
  if (course.absent_trainer_name) {
    return <span className="agenda-note">Vertretung für {course.absent_trainer_name}</span>;
  }
  return null;
}

/** Personal agenda for trainers: what is next, and a day-by-day view of the coming two weeks. */
export default function TrainerAgenda({ data, user, refresh, showError }) {
  const [openCourse, setOpenCourse] = useState(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const today = toIsoDate(now);
  const lastDay = toIsoDate(addDays(now, DAYS_AHEAD - 1));
  const mine = useMemo(
    () =>
      (data.courses || []).filter(
        (c) =>
          (String(c.trainer_id) === String(user.id) ||
            String(c.absent_trainer_id) === String(user.id)) &&
          c.date >= today &&
          c.date <= lastDay,
      ),
    [data.courses, user.id, today, lastDay],
  );

  const days = useMemo(
    () =>
      Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(toLocalDate(today), i))
        // Trainers do not work on weekends, so Saturday and Sunday are left out.
        .filter((d) => d.getDay() !== 0 && d.getDay() !== 6)
        .map((d) => {
          const iso = toIsoDate(d);
          return { iso, courses: mine.filter((c) => c.date === iso) };
        }),
    [mine, today],
  );

  // Courses the trainer actually gives (not cancelled, not handed over while sick).
  const teaching = mine.filter(
    (c) => String(c.trainer_id) === String(user.id) && c.status !== "cancelled",
  );
  const next = teaching.find(
    (c) => new Date(startOf(c).getTime() + (c.duration_minutes || 60) * 60000) > now,
  );

  // Average member rating over all of this trainer's rated courses (weighted by number of ratings).
  const rating = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const c of data.courses || []) {
      if (String(c.trainer_id) === String(user.id) && c.rating_count) {
        sum += c.avg_rating * c.rating_count;
        count += c.rating_count;
      }
    }
    return { avg: count ? sum / count : 0, count };
  }, [data.courses, user.id]);

  const firstBusy = days.find((d) => d.courses.length)?.iso || today;
  const [selected, setSelected] = useState(null);
  const day = days.find((d) => d.iso === (selected || firstBusy)) || days[0];

  // All upcoming shifts (not only the two weeks shown) for the calendar export.
  const allUpcoming = (data.courses || []).filter(
    (c) => String(c.trainer_id) === String(user.id) && c.status !== "cancelled" && c.date >= today,
  );

  const weekEnd = toIsoDate(addDays(now, 6));
  const weekCount = teaching.filter((c) => c.date <= weekEnd).length;
  const subCount = teaching.filter((c) => c.absent_trainer_id).length;

  return (
    <section className="agenda">
      <div className="agenda-layout">
        <div className="agenda-content">
          <div className="agenda-days" role="tablist" aria-label="Tag wählen">
            {days.map((d) => (
              <button
                key={d.iso}
                role="tab"
                aria-selected={d.iso === day.iso}
                className={`agenda-day ${d.iso === day.iso ? "active" : ""} ${d.courses.length ? "" : "empty"}`}
                onClick={() => setSelected(d.iso)}
              >
                <span>{weekdayName(d.iso)}</span>
                <strong>{toLocalDate(d.iso).getDate()}</strong>
                <i aria-hidden="true">
                  {d.courses.map((c) => (
                    <b key={c.id} />
                  ))}
                </i>
              </button>
            ))}
          </div>

          <div className="agenda-list" key={day.iso}>
            <h3>
              {dayLabel(day.iso, today)}, {formatDateShort(day.iso)}
            </h3>
            {day.courses.length === 0 && (
              <p className="agenda-empty">An diesem Tag haben Sie keine Kurse.</p>
            )}
            {day.courses.map((c) => (
              <article
                key={c.id}
                className={`agenda-item ${courseColorClass(c, user)}`}
                role="button"
                tabIndex={0}
                aria-label={`${c.course_type_name} um ${c.start_time} Uhr, Details und Nachricht an Teilnehmer`}
                onClick={() => setOpenCourse(c)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenCourse(c))}
              >
                <div className="agenda-item-time">
                  <strong>{c.start_time}</strong>
                  <span>{endTime(c)}</span>
                </div>
                <div className="agenda-item-body">
                  <h4>{c.course_type_name}</h4>
                  <p>
                    {shortStudioName(c.studio_name)}, {c.room_name}
                  </p>
                  <CourseNote course={c} user={user} />
                </div>
                <Occupancy course={c} />
              </article>
            ))}
          </div>
        </div>

        <aside className="agenda-side">
          {next ? (
            <article
              className={`agenda-next ${courseColorClass(next, user)}`}
              role="button"
              tabIndex={0}
              aria-label={`Als Nächstes: ${next.course_type_name}, Details öffnen`}
              onClick={() => setOpenCourse(next)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenCourse(next))}
            >
              <span className="agenda-label">Als Nächstes</span>
              <span className="agenda-when">{countdown(next, now)}</span>
              <h2>{next.course_type_name}</h2>
              <p className="agenda-time">
                {dayLabel(next.date, today)}, {next.start_time} bis {endTime(next)} Uhr
              </p>
              <p>
                {shortStudioName(next.studio_name)}, {next.room_name}
              </p>
              <CourseNote course={next} user={user} />
              <Occupancy course={next} />
            </article>
          ) : (
            <article className="agenda-next course-neutral">
              <span className="agenda-label">Als Nächstes</span>
              <h2>Nichts geplant</h2>
              <p>In den nächsten zwei Wochen haben Sie keine Kurse.</p>
            </article>
          )}
          <dl className="agenda-stats">
            <div>
              <dt>Kurse in 7 Tagen</dt>
              <dd>{weekCount}</dd>
            </div>
            <div>
              <dt>Minuten auf der Fläche</dt>
              <dd>{weekCount * 60}</dd>
            </div>
            <div>
              <dt>Vertretungen übernommen</dt>
              <dd>{subCount}</dd>
            </div>
            <div>
              <dt>
                Bewertung Ihrer Kurse
                <small className="block">{rating.count} Bewertungen</small>
              </dt>
              <dd>{rating.count ? `★ ${rating.avg.toLocaleString("de-DE", { maximumFractionDigits: 1 })}` : "–"}</dd>
            </div>
          </dl>
          {allUpcoming.length > 0 && (
            <button
              className="secondary"
              onClick={() => downloadCoursesIcs(allUpcoming, "fit-aktiv-schichten.ics")}
              title="Eine .ics-Datei mit allen anstehenden Kursen für Google, Apple oder Outlook"
            >
              Alle Schichten in Kalender eintragen
            </button>
          )}
        </aside>
      </div>

      <MonthOverview data={data} user={user} />

      {openCourse && (
        <StaffCourseDialog
          course={openCourse}
          user={user}
          refresh={refresh}
          showError={showError}
          onClose={() => setOpenCourse(null)}
        />
      )}
    </section>
  );
}
