import { useMemo, useState } from "react";
import { api } from "./api.js";
import { StatusBadge, isMember } from "./courses.jsx";
import { downloadCourseIcs, downloadCoursesIcs } from "./calendar.js";
import MembershipCard from "./MembershipCard.jsx";
import { MembershipSummary, PauseBox, PlanChange } from "./Membership.jsx";
import {
  addDays,
  formatDateLong,
  formatDateShort,
  hasStarted,
  shortStudioName,
  toIsoDate,
  weekdayName,
} from "./format.js";
import WeekPlan, { freePlaces } from "./WeekPlan.jsx";
import { SplitFlapDisplay } from "@/components/ui/split-flap-display";

// The flap board only has A-Z, 0-9 and a few symbols; anything else would
// make a cell flip forever, so map umlauts and drop other characters.
function flapText(text = "") {
  return text
    .toUpperCase()
    .replace(/Ä/g, "AE")
    .replace(/Ö/g, "OE")
    .replace(/Ü/g, "UE")
    .replace(/ß/g, "SS")
    .replace(/[^ A-Z0-9$.,!?:;+\-=%&#@]/g, "");
}

const FLAP_COLUMNS = 24;

const GREETINGS = [
  (n) => `Guten Tag, ${n}.`,
  (n) => `Willkommen zurück, ${n}.`,
  (n) => `Schön, dass Sie da sind, ${n}.`,
  (n) => `Bereit für Ihr Training, ${n}?`,
  (n) => `Auf ein gutes Training, ${n}.`,
];

function useBookings(data) {
  return useMemo(() => {
    const ids = new Set();
    const waiting = new Map();
    for (const b of data.my_bookings || []) {
      if (b.status === "waiting") waiting.set(b.course_id, b.position);
      else ids.add(b.course_id);
    }
    const byStart = (a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`);
    const courses = (data.courses || []).filter((c) => ids.has(c.id)).sort(byStart);
    const waitingCourses = (data.courses || []).filter((c) => waiting.has(c.id)).sort(byStart);
    return { ids, waiting, courses, waitingCourses };
  }, [data.my_bookings, data.courses]);
}

function useBookingActions(refresh, showError) {
  const [busy, setBusy] = useState(false);
  // The last error stays here too, so an open booking window can show it instead of the page behind it.
  const [error, setError] = useState("");
  async function run(action, ...args) {
    setBusy(true);
    setError("");
    try {
      await action(...args);
      await refresh();
      return true;
    } catch (err) {
      setError(err.message);
      showError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    clearError: () => setError(""),
    book: (courseId) => run(api.bookCourse, courseId),
    cancel: (courseId) => run(api.cancelBooking, courseId),
    join: (courseId) => run(api.joinWaitlist, courseId),
    leave: (courseId) => run(api.leaveWaitlist, courseId),
    favorite: (kind, id, on) => run(api.setFavorite, kind, id, on),
    rate: (courseId, stars) => run(api.rateCourse, courseId, stars),
  };
}

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Basic members: how many of their monthly courses are used in the month of `isoDate`. */
function basicQuota(data, isoDate) {
  if (data.me?.membership_type !== "basic") return null;
  const limit = data.basic_courses_per_month ?? 4;
  const month = isoDate.slice(0, 7);
  const mine = new Set((data.my_bookings || []).map((b) => b.course_id));
  const used = (data.courses || []).filter((c) => mine.has(c.id) && c.date.startsWith(month)).length;
  return { used, limit, full: used >= limit, monthName: MONTH_NAMES[Number(month.slice(5, 7)) - 1] };
}

function courseStart(course) {
  return new Date(`${course.date}T${course.start_time}:00`);
}

/** Latest moment a booking can still be cancelled, or null when that moment has passed. */
function cancelDeadline(course, hours) {
  const deadline = new Date(courseStart(course).getTime() - hours * 3600000);
  return deadline > new Date() ? deadline : null;
}

function deadlineText(course, hours) {
  const d = new Date(courseStart(course).getTime() - hours * 3600000);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} Uhr`;
  return toIsoDate(d) === course.date ? time : `${formatDateShort(toIsoDate(d))}, ${time}`;
}

function isFavorite(data, kind, id) {
  return (data.me?.favorites || []).some((f) => f.kind === kind && f.target_id === id);
}

function FavoriteButton({ data, kind, id, label, busy, onToggle }) {
  const on = isFavorite(data, kind, id);
  return (
    <button
      type="button"
      className={`fav-button ${on ? "on" : ""}`}
      aria-pressed={on}
      disabled={busy}
      onClick={() => onToggle(kind, id, !on)}
      title={on ? `${label} aus den Favoriten entfernen` : `${label} als Favorit merken`}
    >
      <span aria-hidden="true">{on ? "★" : "☆"}</span> {label}
    </button>
  );
}

function StarRating({ value, busy, onRate }) {
  return (
    <div className="star-rating" role="group" aria-label="Kurs bewerten">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= (value || 0) ? "on" : ""}
          disabled={busy}
          aria-label={`${n} von 5 Sternen`}
          aria-pressed={n === value}
          onClick={() => onRate(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function BookingDialog({ course, data, booked, position, actions, onClose }) {
  const quota = basicQuota(data, course.date);
  const otherStudio =
    data.me?.membership_type === "basic" && data.me?.home_studio_id && course.studio_id !== data.me.home_studio_id;
  const blocked = !booked && !position && (otherStudio || quota?.full);
  const hours = data.cancel_deadline_hours ?? 2;
  const free = freePlaces(course);
  const past = hasStarted(course);
  const open = course.status === "active" && !past;
  const canCancel = Boolean(cancelDeadline(course, hours));
  const { busy } = actions;
  const done = (ok) => ok && onClose();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal booking-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{course.course_type_name}</h2>
        <dl className="booking-facts">
          <div>
            <dt>Wann</dt>
            <dd>
              {weekdayName(course.date, true)}, {formatDateLong(course.date)}, {course.start_time} Uhr
              ({course.duration_minutes} min)
            </dd>
          </div>
          <div>
            <dt>Wo</dt>
            <dd>
              {shortStudioName(course.studio_name)}, {course.room_name}
            </dd>
          </div>
          <div>
            <dt>Trainer</dt>
            <dd>{course.trainer_name || "wird noch eingeteilt"}</dd>
          </div>
          <div>
            <dt>Plätze</dt>
            <dd>
              {free} von {course.capacity} frei
              {course.waiting_count > 0 && `, ${course.waiting_count} auf der Warteliste`}
            </dd>
          </div>
          {course.rating_count > 0 && (
            <div>
              <dt>Bewertung</dt>
              <dd>
                ★ {Number(course.avg_rating).toLocaleString("de-DE")} ({course.rating_count})
              </dd>
            </div>
          )}
        </dl>
        <div className="fav-row">
          <FavoriteButton
            data={data}
            kind="course_type"
            id={course.course_type_id}
            label={course.course_type_name}
            busy={busy}
            onToggle={actions.favorite}
          />
          {course.trainer_id && (
            <FavoriteButton
              data={data}
              kind="trainer"
              id={course.trainer_id}
              label={course.trainer_name}
              busy={busy}
              onToggle={actions.favorite}
            />
          )}
        </div>
        {course.status !== "active" && (
          <p className="booking-note">
            {course.status === "cancelled"
              ? "Dieser Kurs fällt aus."
              : "Für diesen Kurs wird gerade eine Vertretung gesucht. Buchen ist wieder möglich, sobald sie feststeht."}
          </p>
        )}
        {past && <p className="booking-note">Dieser Kurs hat schon begonnen.</p>}
        {!booked && !position && !past && otherStudio && (
          <p className="booking-note limit">
            Mit Ihrem Tarif Basic können Sie nur Kurse in Ihrem Heimstudio{" "}
            {shortStudioName(data.me.home_studio_name || "")} buchen. Mit Plus trainieren Sie in allen 22 Studios.
          </p>
        )}
        {!booked && !position && !past && !otherStudio && quota?.full && (
          <p className="booking-note limit">
            Mit Ihrem Tarif Basic sind {quota.limit} Kurse pro Monat enthalten. Im {quota.monthName} haben Sie alle{" "}
            {quota.limit} bereits gebucht. Ab dem nächsten Monat ist das wieder möglich, oder Sie wechseln unter
            „Mein Profil“ zu Plus für unbegrenzte Kurse.
          </p>
        )}
        {actions.error && (
          <p className="booking-note limit" role="alert">
            {actions.error}
          </p>
        )}
        {booked && !past && (
          <p className="booking-note">
            {canCancel
              ? `Kostenlos stornieren bis ${deadlineText(course, hours)}.`
              : `Stornieren ist nur bis ${hours} Stunden vor Kursbeginn möglich.`}
          </p>
        )}
        {position && (
          <p className="booking-note">
            Sie stehen auf Platz {position} der Warteliste. Wird ein Platz frei, rücken Sie automatisch nach und erhalten
            eine Nachricht.
          </p>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Schließen
          </button>
          {booked && !past && (
            <button className="secondary" onClick={() => downloadCourseIcs(course)}>
              In Kalender eintragen
            </button>
          )}
          {booked ? (
            !past && (
              <button className="danger" disabled={busy || !canCancel} onClick={async () => done(await actions.cancel(course.id))}>
                Buchung stornieren
              </button>
            )
          ) : position ? (
            <button className="danger" disabled={busy} onClick={async () => done(await actions.leave(course.id))}>
              Warteliste verlassen
            </button>
          ) : free > 0 ? (
            <button disabled={!open || busy || blocked} onClick={async () => done(await actions.book(course.id))}>
              Platz buchen
            </button>
          ) : (
            <button disabled={!open || busy || blocked} onClick={async () => done(await actions.join(course.id))}>
              Auf die Warteliste
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Unread messages for the member (trainer changes, cancelled courses).
export function MemberNotices({ data, refresh, showError }) {
  const unread = (data.notifications || []).filter((n) => !n.is_read);
  if (unread.length === 0) return null;

  async function dismiss(id) {
    try {
      await api.markNotificationRead(id);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }

  return (
    <div className="member-notices" role="status">
      {unread.map((n) => (
        <div key={n.id} className="member-notice">
          <div>
            <strong>Neue Nachricht</strong>
            <p>{n.message}</p>
          </div>
          <button onClick={() => dismiss(n.id)}>Verstanden</button>
        </div>
      ))}
    </div>
  );
}

export function MemberDashboard({ data, user, refresh, showError, setActiveTab }) {
  const { ids, waiting, courses } = useBookings(data);
  const actions = useBookingActions(refresh, showError);
  const [openCourse, setOpenCourse] = useState(null);
  const [greet] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  const me = data.me || user;
  const nextCourse = courses.find((c) => !hasStarted(c) && c.status !== "cancelled");
  const quota = basicQuota(data, toIsoDate(new Date()));
  const closeDialog = () => {
    setOpenCourse(null);
    actions.clearError();
  };

  return (
    <section className="page-grid">
      {quota && (
        <div className={`quota-notice ${quota.full ? "full" : ""}`} role="status">
          <div>
            <strong>
              {quota.full
                ? `Sie haben alle ${quota.limit} Kurse für ${quota.monthName} gebucht`
                : `${quota.used} von ${quota.limit} Kursen im ${quota.monthName} gebucht`}
            </strong>
            <span>
              {quota.full
                ? "Ihr Tarif Basic enthält 4 Kurse pro Monat in Ihrem Heimstudio. Ab dem 1. des nächsten Monats können Sie wieder buchen."
                : "Ihr Tarif Basic enthält 4 Kurse pro Monat in Ihrem Heimstudio."}
            </span>
          </div>
          <button className="secondary" onClick={() => setActiveTab("Profil")}>
            Zu Plus wechseln
          </button>
        </div>
      )}
      <div className="member-hero">
        <div>
          <h1>{greet(me?.name || "")}</h1>
          {/* Hidden (space kept) until the member data has loaded, so it never flashes "nicht gewählt". */}
          <p style={{ visibility: data.me ? "visible" : "hidden" }}>
            Ihr Studio: <strong>{me?.home_studio_name ? shortStudioName(me.home_studio_name) : "nicht gewählt"}</strong>.
            Unten sehen Sie den Kursplan Ihres Studios. Tippen Sie auf einen Kurs, um einen Platz zu buchen.
          </p>
        </div>
        <div className="next-course">
          <span>Ihr nächster Kurs</span>
          {nextCourse ? (
            <>
              <div className="flap-board" aria-hidden="true">
                <SplitFlapDisplay
                  size="sm"
                  columns={FLAP_COLUMNS}
                  accentColor="#c8a96a"
                  rows={[
                    { label: "KURS", value: flapText(nextCourse.course_type_name) },
                    {
                      label: "TAG",
                      value: flapText(`${weekdayName(nextCourse.date)} ${formatDateLong(nextCourse.date).slice(0, 6)}`),
                    },
                    { label: "ZEIT", value: flapText(`${nextCourse.start_time} UHR`) },
                    { label: "STUDIO", value: flapText(shortStudioName(nextCourse.studio_name)).slice(0, FLAP_COLUMNS - 7) },
                  ]}
                />
              </div>
              <p className="sr-only">
                {nextCourse.course_type_name}, {weekdayName(nextCourse.date, true)}, {formatDateLong(nextCourse.date)},{" "}
                {nextCourse.start_time} Uhr, {shortStudioName(nextCourse.studio_name)}
              </p>
            </>
          ) : (
            <small>Noch nichts gebucht. Tippen Sie unten im Kursplan auf einen Kurs.</small>
          )}
          <button className="text-link" onClick={() => setActiveTab("Meine Kurse")}>
            Alle Buchungen ansehen
          </button>
        </div>
      </div>

      <WeekPlan
        data={data}
        user={user}
        defaultStudioId={me?.home_studio_id ?? "all"}
        bookedIds={ids}
        waitingIds={waiting}
        onCourseClick={setOpenCourse}
      />

      {openCourse && (
        <BookingDialog
          course={openCourse}
          data={data}
          booked={ids.has(openCourse.id)}
          position={waiting.get(openCourse.id)}
          actions={actions}
          onClose={closeDialog}
        />
      )}
    </section>
  );
}

export function MyCourses({ data, refresh, showError, setActiveTab }) {
  const { ids, waiting, courses, waitingCourses } = useBookings(data);
  const actions = useBookingActions(refresh, showError);
  const { busy } = actions;
  const hours = data.cancel_deadline_hours ?? 2;
  const [openCourse, setOpenCourse] = useState(null);
  const upcoming = courses.filter((c) => !hasStarted(c));
  const past = courses.filter((c) => hasStarted(c)).reverse();
  const waitingUpcoming = waitingCourses.filter((c) => !hasStarted(c));
  const myRatings = new Map((data.me?.ratings || []).map((r) => [r.course_id, r.stars]));

  // Courses this week (and next) that match a favourite course type or trainer and are not booked yet.
  const favorites = useMemo(() => {
    const favs = data.me?.favorites || [];
    if (!favs.length) return [];
    const until = toIsoDate(addDays(new Date(), 7));
    return (data.courses || [])
      .filter(
        (c) =>
          c.status === "active" &&
          !hasStarted(c) &&
          c.date <= until &&
          !ids.has(c.id) &&
          !waiting.has(c.id) &&
          favs.some(
            (f) =>
              (f.kind === "course_type" && f.target_id === c.course_type_id) ||
              (f.kind === "trainer" && f.target_id === c.trainer_id),
          ) &&
          (!data.me?.home_studio_id || c.studio_id === data.me.home_studio_id),
      )
      .slice(0, 6);
  }, [data.courses, data.me, ids, waiting]);

  async function cancelBooking(course) {
    if (!confirm(`${course.course_type_name} am ${formatDateLong(course.date)} wirklich stornieren?`)) return;
    await actions.cancel(course.id);
  }

  const row = (c, extra) => (
    <li key={c.id} className={c.status === "cancelled" ? "cancelled" : ""}>
      <div className="booking-date">
        <strong>{weekdayName(c.date)}</strong>
        <span>{formatDateLong(c.date).slice(0, 6)}</span>
      </div>
      <div className="booking-main">
        <strong>{c.course_type_name}</strong>
        <small>
          {c.start_time} Uhr, {shortStudioName(c.studio_name)}, {c.room_name}
          {c.trainer_name ? `, mit ${c.trainer_name}` : ""}
        </small>
      </div>
      {extra}
    </li>
  );

  return (
    <section className="page-grid">
      <div className="panel wide">
        <div className="panel-title">
          <h2>Anstehend</h2>
          {upcoming.length > 0 && (
            <button
              className="secondary"
              onClick={() => downloadCoursesIcs(upcoming, "fit-aktiv-kurse.ics")}
              title="Eine .ics-Datei mit allen anstehenden Kursen für Google, Apple oder Outlook"
            >
              Alle in Kalender eintragen
            </button>
          )}
        </div>
        {upcoming.length || waitingUpcoming.length ? (
          <ul className="booking-list">
            {upcoming.map((c) => {
              const canCancel = Boolean(cancelDeadline(c, hours));
              return row(
                c,
                <>
                  <StatusBadge status={c.status} />
                  <div className="booking-actions">
                    <button
                      className="secondary"
                      disabled={busy || !canCancel}
                      onClick={() => cancelBooking(c)}
                      title={canCancel ? `Stornieren bis ${deadlineText(c, hours)}` : "Stornierfrist abgelaufen"}
                    >
                      Stornieren
                    </button>
                    <small>{canCancel ? `bis ${deadlineText(c, hours)}` : "Frist vorbei"}</small>
                  </div>
                </>,
              );
            })}
            {waitingUpcoming.map((c) =>
              row(
                c,
                <>
                  <span className="badge orange">Warteliste, Platz {waiting.get(c.id)}</span>
                  <div className="booking-actions">
                    <button className="secondary" disabled={busy} onClick={() => actions.leave(c.id)}>
                      Verlassen
                    </button>
                  </div>
                </>,
              ),
            )}
          </ul>
        ) : (
          <div className="empty neutral">
            Sie haben keine Kurse gebucht.{" "}
            <button className="text-link" onClick={() => setActiveTab("Dashboard")}>
              Zum Kursplan
            </button>
          </div>
        )}
      </div>

      <div className="panel wide">
        <h2>Ihre Favoriten in den nächsten 7 Tagen</h2>
        {favorites.length ? (
          <ul className="booking-list">
            {favorites.map((c) =>
              row(
                c,
                <>
                  <span className="muted">{freePlaces(c) > 0 ? `${freePlaces(c)} Plätze frei` : "ausgebucht"}</span>
                  <div className="booking-actions">
                    <button onClick={() => setOpenCourse(c)}>Ansehen</button>
                  </div>
                </>,
              ),
            )}
          </ul>
        ) : (
          <p className="muted">
            {(data.me?.favorites || []).length
              ? "Gerade keine freien Termine Ihrer Favoriten in Ihrem Studio."
              : "Markieren Sie im Kursplan einen Kurs oder Trainer mit ☆, dann erscheinen die nächsten Termine hier."}
          </p>
        )}
      </div>

      {past.length > 0 && (
        <div className="panel wide">
          <h2>Vergangen</h2>
          <ul className="booking-list">
            {past.map((c) =>
              row(
                c,
                c.status === "cancelled" ? (
                  <StatusBadge status={c.status} />
                ) : (
                  <StarRating value={myRatings.get(c.id)} busy={busy} onRate={(n) => actions.rate(c.id, n)} />
                ),
              ),
            )}
          </ul>
        </div>
      )}

      {openCourse && (
        <BookingDialog
          course={openCourse}
          data={data}
          booked={ids.has(openCourse.id)}
          position={waiting.get(openCourse.id)}
          actions={actions}
          onClose={() => {
            setOpenCourse(null);
            actions.clearError();
          }}
        />
      )}
    </section>
  );
}

function PasswordBox({ staff, showError }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password !== repeat) return showError("Die beiden Passwörter stimmen nicht überein.");
    try {
      await (staff ? api.updateEmployeeProfile : api.updateOwnProfile)({ new_password: password });
      setPassword("");
      setRepeat("");
      setSaved(true);
    } catch (err) {
      showError(err.message);
    }
  }

  return (
    <form className="panel profile-box profile-form" onSubmit={submit}>
      <h2>Passwort ändern</h2>
      <label>
        Neues Passwort
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setSaved(false);
          }}
        />
        <small>Mindestens 8 Zeichen.</small>
      </label>
      <label>
        Passwort wiederholen
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="submit">Passwort speichern</button>
        {saved && (
          <span className="saved-note" role="status">
            Gespeichert
          </span>
        )}
      </div>
    </form>
  );
}

/** Profile for members and staff, one box per topic. Staff see their work data read-only. */
export function MemberProfile({ data, user, refresh, showError, onUserUpdate }) {
  const staff = !isMember(user);
  const me =
    (staff ? (data.employees || []).find((e) => String(e.id) === String(user?.id)) : data.me) ||
    user ||
    {};
  const [form, setForm] = useState({
    name: me.name || "",
    phone: me.phone || "",
    birth_date: me.birth_date || "",
    address: me.address || "",
    home_studio_id: me.home_studio_id || "",
  });
  const [saved, setSaved] = useState(false);
  const set = (key) => (e) => {
    setSaved(false);
    setForm({ ...form, [key]: e.target.value });
  };
  const box = { data, refresh, showError };

  async function submit(e) {
    e.preventDefault();
    try {
      const { home_studio_id, ...personal } = form;
      const res = staff
        ? await api.updateEmployeeProfile(personal)
        : await api.updateOwnProfile({
            ...personal,
            home_studio_id: home_studio_id ? Number(home_studio_id) : null,
          });
      onUserUpdate(res.user);
      setSaved(true);
      await refresh();
    } catch (err) {
      showError(err.message);
    }
  }

  const personal = (
    <form className="panel profile-box profile-form" onSubmit={submit}>
      <h2>Persönliche Daten</h2>
      <label>
        Name
        <input required autoComplete="name" value={form.name} onChange={set("name")} />
      </label>
      <label>
        E-Mail
        <input value={me.email || ""} disabled />
        <small>Die E-Mail-Adresse ist Ihr Login und kann hier nicht geändert werden.</small>
      </label>
      <div className="form-row">
        <label>
          Telefon
          <input type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} />
        </label>
        <label>
          Geburtsdatum
          <input type="date" value={form.birth_date} onChange={set("birth_date")} />
        </label>
      </div>
      <label>
        Adresse
        <input
          autoComplete="street-address"
          value={form.address}
          onChange={set("address")}
          placeholder="Straße, PLZ Ort"
        />
      </label>
      {!staff && (
        <label>
          Mein Studio
          <select value={form.home_studio_id} onChange={set("home_studio_id")}>
            <option value="">Kein Studio gewählt</option>
            {(data.studios || []).map((s) => (
              <option key={s.id} value={s.id}>
                {shortStudioName(s.name)}
              </option>
            ))}
          </select>
          <small>Der Kursplan zeigt beim Anmelden zuerst dieses Studio.</small>
        </label>
      )}
      <div className="form-actions">
        <button type="submit">Änderungen speichern</button>
        {saved && (
          <span className="saved-note" role="status">
            Gespeichert
          </span>
        )}
      </div>
    </form>
  );

  if (staff) {
    return (
      <section className="profile-page">
        <div className="profile-side">
          <MembershipCard member={me} staff />
          <aside className="panel profile-box work-data">
            <h2>Arbeitsdaten</h2>
            <dl className="profile-facts">
              <div>
                <dt>Heimstudio</dt>
                <dd>{me.home_studio_name}</dd>
              </div>
              <div>
                <dt>Qualifikationen</dt>
                <dd>{(me.qualifications || "").split(",").join(", ")}</dd>
              </div>
              <div>
                <dt>Modell</dt>
                <dd>
                  {me.employment_model}, {me.weekly_hours} Std. pro Woche
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={me.status} />
                </dd>
              </div>
            </dl>
            <small className="muted">
              {user?.role === "admin"
                ? "Arbeitsdaten ändern Sie unter Mitarbeiter."
                : "Änderungen an Ihren Arbeitsdaten nimmt die Studioleitung vor."}
            </small>
          </aside>
        </div>
        <div className="profile-main">
          {personal}
          <PasswordBox staff showError={showError} />
        </div>
      </section>
    );
  }

  return (
    <section className="profile-page">
      <div className="profile-side">
        <MembershipCard member={me} />
        <MembershipSummary {...box} />
        <PauseBox {...box} />
      </div>
      <div className="profile-main">
        {personal}
        <PasswordBox showError={showError} />
      </div>
      <div className="profile-wide">
        <PlanChange {...box} />
      </div>
    </section>
  );
}
