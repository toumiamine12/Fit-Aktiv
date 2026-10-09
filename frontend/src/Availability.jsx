import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { isAdmin } from "./courses.jsx";
import {
  addDays,
  formatDateShort,
  isoWeekNumber,
  mondayOf,
  toIsoDate,
  toLocalDate,
  todayIso,
} from "./format.js";

// Courses run Monday to Friday, so only these days are planned.
const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const WEEKS_AHEAD = 4;

/** Slots for one week: the week's own entries if it was edited, otherwise the standard week. */
export function weekSlots(availabilities, employeeId, monday) {
  const mine = (availabilities || []).filter((a) => String(a.employee_id) === String(employeeId));
  const edited = mine.filter((a) => a.week_start === monday);
  return edited.length ? edited : mine.filter((a) => !a.week_start);
}

function minutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function rowsFor(availabilities, employeeId, monday) {
  const slots = weekSlots(availabilities, employeeId, monday);
  return DAYS.map((_, weekday) => {
    const slot = slots.find((a) => a.weekday === weekday);
    return slot
      ? { on: true, start_time: slot.start_time, end_time: slot.end_time }
      : { on: false, start_time: "08:00", end_time: "16:00" };
  });
}

/** Weekly availability for the current and the next three weeks, within the contract hours band. */
export default function AvailabilityEditor({ data, user, refresh, showError }) {
  const admin = isAdmin(user);
  const today = todayIso();
  const weeks = useMemo(() => {
    const first = mondayOf(toLocalDate(today));
    return Array.from({ length: WEEKS_AHEAD }, (_, i) => toIsoDate(addDays(first, i * 7)));
  }, [today]);
  const [employeeId, setEmployeeId] = useState(user.id);
  const [monday, setMonday] = useState(weeks[0]);
  const [rows, setRows] = useState(() => rowsFor(data.availabilities, user.id, weeks[0]));
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  // Load the saved times when the person or week changes (not on every live refresh, so edits are kept).
  useEffect(() => {
    setRows(rowsFor(data.availabilities, employeeId, monday));
    setResult("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, monday]);

  const employee = (data.employees || []).find((e) => String(e.id) === String(employeeId)) || {};
  const minHours = employee.min_available_hours ?? 0;
  const maxHours = employee.max_available_hours ?? Infinity;
  const edited = (data.availabilities || []).some(
    (a) => String(a.employee_id) === String(employeeId) && a.week_start === monday,
  );
  const dayIso = (weekday) => toIsoDate(addDays(toLocalDate(monday), weekday));
  const coursesOn = (weekday) =>
    (data.courses || []).filter(
      (c) =>
        String(c.trainer_id) === String(employeeId) &&
        c.status === "active" &&
        c.date === dayIso(weekday),
    );

  const sumHours = (items) =>
    items.reduce((sum, r) => sum + (r.on === false ? 0 : Math.max(0, minutes(r.end_time) - minutes(r.start_time))), 0) / 60;
  const hours = sumHours(rows);
  const savedHours = sumHours(weekSlots(data.availabilities, employeeId, monday));
  const weekCourses = DAYS.flatMap((_, weekday) => coursesOn(weekday));
  const plannedHours = weekCourses.reduce((sum, c) => sum + (c.duration_minutes || 60), 0) / 60;
  // Fully planned weeks (course limit or maximum hours reached) cannot get more availability.
  const full = weekCourses.length >= (employee.max_courses_per_week || Infinity) || plannedHours >= maxHours;
  const tooFew = hours < minHours;
  const grows = full && hours > savedHours;
  // Counter: hours of work planned this week against the maximum for the employment model.
  const overWork = plannedHours > maxHours;
  const share = Number.isFinite(maxHours) && maxHours ? Math.min(100, (plannedHours / maxHours) * 100) : 0;

  const update = (weekday, patch) => {
    setResult("");
    setRows(rows.map((row, i) => (i === weekday ? { ...row, ...patch } : row)));
  };

  function toggle(weekday, on) {
    const courses = coursesOn(weekday);
    if (!on && courses.length) {
      showError(
        `Am ${DAYS[weekday]} ${admin ? "sind" : "haben Sie"} ${courses.length} ${
          courses.length === 1 ? "Kurs" : "Kurse"
        } eingeplant (${courses.map((c) => `${c.start_time} ${c.course_type_name}`).join(", ")}). ` +
          "Der Tag kann nicht ausgetragen werden. Für einen Ausfall bitte eine Krankmeldung eintragen.",
      );
      return;
    }
    update(weekday, { on });
  }

  async function save(e) {
    e.preventDefault();
    const bad = rows.findIndex((r) => r.on && r.start_time >= r.end_time);
    if (bad !== -1) return showError(`${DAYS[bad]}: Die Endzeit muss nach der Startzeit liegen.`);
    const slots = rows.flatMap((r, weekday) =>
      r.on ? [{ weekday, start_time: r.start_time, end_time: r.end_time }] : [],
    );
    setBusy(true);
    try {
      await api.setAvailability(employeeId, monday, slots);
      await refresh();
      setResult(`KW ${isoWeekNumber(monday)} gespeichert. Neue Kurse werden nur in diese Zeiten gelegt.`);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel availability" onSubmit={save}>
      <h2>{admin ? "Verfügbarkeit" : "Wann können Sie Kurse geben?"}</h2>
      {admin && (
        <label className="availability-person">
          Mitarbeiter
          <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
            {(data.employees || []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="availability-weeks" role="tablist" aria-label="Woche wählen">
        {weeks.map((w) => (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={w === monday}
            className={w === monday ? "active" : ""}
            onClick={() => setMonday(w)}
          >
            <strong>KW {isoWeekNumber(w)}</strong>
            <span>
              {formatDateShort(w)} bis {formatDateShort(toIsoDate(addDays(toLocalDate(w), 4)))}
            </span>
          </button>
        ))}
      </div>

      <div className={`availability-hours ${overWork ? "out" : ""}`}>
        <div>
          <strong>{plannedHours.toLocaleString("de-DE")} Std. Arbeit</strong>
          <span>
            von höchstens {maxHours} Std. ({employee.employment_model}), {weekCourses.length}{" "}
            {weekCourses.length === 1 ? "Kurs" : "Kurse"} geplant
          </span>
        </div>
        <div className="occupancy-bar">
          <span style={{ width: `${share}%` }} />
        </div>
        {overWork && (
          <small className="warn">
            {(plannedHours - maxHours).toLocaleString("de-DE")} Std. über dem Maximum. Bitte mit der Studioleitung
            klären.
          </small>
        )}
        <span className={tooFew || grows ? "warn" : ""}>
          Verfügbar: {hours.toLocaleString("de-DE")} Std., mindestens {minHours} Std.
          {tooFew && ` Es fehlen noch ${(minHours - hours).toLocaleString("de-DE")} Std.`}
          {grows && ` Die Woche ist voll verplant, höchstens ${savedHours.toLocaleString("de-DE")} Std. möglich.`}
        </span>
        {!edited && <small>Für diese Woche gelten noch die Standardzeiten.</small>}
      </div>

      <div className="availability-days">
        {rows.map((row, weekday) => {
          const past = dayIso(weekday) < today;
          const courses = coursesOn(weekday);
          return (
            <div key={DAYS[weekday]} className={`availability-day ${row.on ? "on" : ""} ${past ? "past" : ""}`}>
              <label className="availability-toggle">
                <input
                  type="checkbox"
                  checked={row.on}
                  disabled={past}
                  onChange={(e) => toggle(weekday, e.target.checked)}
                />
                <span>
                  {DAYS[weekday]}
                  <small>
                    {formatDateShort(dayIso(weekday))}
                    {courses.length > 0 && `, ${courses.length} ${courses.length === 1 ? "Kurs" : "Kurse"}`}
                  </small>
                </span>
              </label>
              {row.on ? (
                <div className="availability-times">
                  <input
                    type="time"
                    step="1800"
                    disabled={past}
                    aria-label={`${DAYS[weekday]} von`}
                    value={row.start_time}
                    onChange={(e) => update(weekday, { start_time: e.target.value })}
                  />
                  <span>bis</span>
                  <input
                    type="time"
                    step="1800"
                    disabled={past}
                    aria-label={`${DAYS[weekday]} bis`}
                    value={row.end_time}
                    onChange={(e) => update(weekday, { end_time: e.target.value })}
                  />
                </div>
              ) : (
                <span className="availability-off">nicht verfügbar</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-actions">
        <button type="submit" disabled={busy || tooFew || grows}>
          {busy ? "Speichert…" : `KW ${isoWeekNumber(monday)} speichern`}
        </button>
      </div>
      {result && (
        <p className="saved-note" role="status">
          {result}
        </p>
      )}
    </form>
  );
}
