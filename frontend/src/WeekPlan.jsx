import { Fragment, useMemo, useState } from "react";
import {
  CourseStatusBadge,
  courseColorClass,
  courseRowClass,
  isAdmin,
  isMember,
  isOwnAbsentCourse,
  trainerCell,
} from "./courses.jsx";
import {
  addDays,
  formatDateLong,
  formatDateShort,
  hasStarted,
  isoWeekNumber,
  mondayOf,
  shortStudioName,
  toIsoDate,
  toLocalDate,
  todayIso,
  weekdayName,
} from "./format.js";

// Time-of-day filter for members: label and hour test.
const TIME_SLOTS = {
  morning: ["Vormittags (bis 12 Uhr)", (h) => h < 12],
  midday: ["Mittags (12 bis 16 Uhr)", (h) => h >= 12 && h < 16],
  evening: ["Abends (ab 16 Uhr)", (h) => h >= 16],
};

const HOURS = Array.from({ length: 15 }, (_, index) => index + 7);

export function freePlaces(course) {
  return Math.max(0, (course.capacity || 0) - (course.booked_count || 0));
}

/**
 * Weekly timetable with studio filter. Used on the public home page, the
 * member area and the staff dashboard. Pass `studioId` + `onStudioChange` to
 * control the studio filter from outside, or `defaultStudioId` to only set
 * the starting studio.
 */
export default function WeekPlan({
  data,
  user,
  studioId,
  onStudioChange,
  defaultStudioId = "all",
  bookedIds,
  waitingIds,
  onCourseClick,
  showTable = true,
}) {
  const [weekStart, setWeekStart] = useState(() =>
    toIsoDate(mondayOf(toLocalDate(todayIso()))),
  );
  const [ownStudioId, setOwnStudioId] = useState(defaultStudioId);
  const selectedStudioId = studioId ?? ownStudioId;
  const setSelectedStudioId = onStudioChange ?? setOwnStudioId;
  const member = isMember(user);
  const staff = Boolean(user) && !member;
  // Trainers only see their own courses, so the studio filter is left out for them.
  const trainer = staff && !isAdmin(user);
  // Member filters: course type, time of day, favourites only.
  const [typeFilter, setTypeFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [favOnly, setFavOnly] = useState(false);
  const favorites = data.me?.favorites || [];
  const isFavorite = (c) =>
    favorites.some(
      (f) =>
        (f.kind === "course_type" && f.target_id === c.course_type_id) ||
        (f.kind === "trainer" && f.target_id === c.trainer_id),
    );

  const weekDays = useMemo(() => {
    const start = toLocalDate(weekStart);
    return Array.from({ length: 5 }, (_, index) =>
      toIsoDate(addDays(start, index)),
    );
  }, [weekStart]);
  const weekEnd = weekDays[weekDays.length - 1];
  const selectedStudio = (data.studios || []).find(
    (s) => String(s.id) === String(selectedStudioId),
  );

  const weeklyCourses = useMemo(() => {
    return (data.courses || [])
      .filter((c) => c.date >= weekStart && c.date <= weekEnd)
      .filter(
        (c) =>
          selectedStudioId === "all" ||
          String(c.studio_id) === String(selectedStudioId),
      )
      .filter(
        (c) =>
          !staff ||
          isAdmin(user) ||
          String(c.trainer_id) === String(user.id) ||
          String(c.absent_trainer_id) === String(user.id),
      )
      .filter((c) => !member || typeFilter === "all" || String(c.course_type_id) === typeFilter)
      .filter((c) => {
        if (!member || timeFilter === "all") return true;
        const hour = Number(c.start_time.slice(0, 2));
        return TIME_SLOTS[timeFilter][1](hour);
      })
      .filter((c) => !member || !favOnly || isFavorite(c))
      .sort((a, b) =>
        `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`),
      );
    // isFavorite only depends on the favourites list, which is part of data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.courses, data.me, weekStart, weekEnd, selectedStudioId, user, staff, member, typeFilter, timeFilter, favOnly]);

  // Members only need what they can still book; past courses stay visible in the calendar above.
  const tableCourses = member ? weeklyCourses.filter((c) => !hasStarted(c)) : weeklyCourses;

  const coursesForSlot = (dayIso, hour) =>
    weeklyCourses.filter((c) => {
      const startHour = Number((c.start_time || "00:00").slice(0, 2));
      return c.date === dayIso && startHour === hour;
    });

  const goToToday = () =>
    setWeekStart(toIsoDate(mondayOf(toLocalDate(todayIso()))));
  const moveWeek = (amount) =>
    setWeekStart(toIsoDate(addDays(toLocalDate(weekStart), amount * 7)));
  const isBooked = (course) => Boolean(bookedIds?.has(course.id));
  const waitingPosition = (course) => waitingIds?.get(course.id);
  const spotsText = (c) =>
    isBooked(c)
      ? "Gebucht"
      : waitingPosition(c)
        ? `Warteliste, Platz ${waitingPosition(c)}`
        : hasStarted(c)
          ? "Vorbei"
          : freePlaces(c) > 0
            ? `${freePlaces(c)} Plätze frei`
            : "Ausgebucht, Warteliste";

  return (
    <div className="panel wide weekly-plan-panel">
      <div className="plan-toolbar">
        <div className="week-toolbar" role="group" aria-label="Woche wählen">
          <button
            className="ghost"
            onClick={() => moveWeek(-1)}
            aria-label="Vorige Woche"
          >
            ‹
          </button>
          <button className="ghost today-button" onClick={goToToday}>
            Diese Woche
          </button>
          <button
            className="ghost"
            onClick={() => moveWeek(1)}
            aria-label="Nächste Woche"
          >
            ›
          </button>
        </div>
        <p className="week-label">
          <strong>KW {isoWeekNumber(weekStart)}</strong>{" "}
          {formatDateShort(weekStart)} bis {formatDateLong(weekEnd)}
        </p>
        <p className="plan-summary">
          {weeklyCourses.length} Kurse
          {trainer
            ? " diese Woche"
            : ` in ${selectedStudio ? shortStudioName(selectedStudio.name) : "allen Studios"}`}
        </p>
      </div>

      {member && (
        <div className="plan-filters">
          <label>
            Kursart
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">Alle Kurse</option>
              {(data.course_types || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tageszeit
            <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}>
              <option value="all">Den ganzen Tag</option>
              {Object.entries(TIME_SLOTS).map(([key, [label]]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="plan-filter-check">
            <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
            Nur meine Favoriten ★
          </label>
        </div>
      )}

      {!trainer && (
        <div className="dashboard-filter-row">
          <span className="filter-label">Studio</span>
          <div className="studio-filter">
            <button
              className={
                selectedStudioId === "all" ? "studio-chip active" : "studio-chip"
              }
              onClick={() => setSelectedStudioId("all")}
            >
              Alle Studios
            </button>
            {(data.studios || []).map((studio) => (
              <button
                key={studio.id}
                title={studio.name}
                className={
                  String(selectedStudioId) === String(studio.id)
                    ? "studio-chip active"
                    : "studio-chip"
                }
                onClick={() => setSelectedStudioId(studio.id)}
              >
                {shortStudioName(studio.name)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="calendar-scroll">
        <div className="week-calendar">
          <div className="calendar-corner">Uhrzeit</div>
          {weekDays.map((day) => (
            <div
              key={day}
              className={`calendar-day-head ${day === todayIso() ? "today" : ""}`}
            >
              <strong>{weekdayName(day)}</strong>
              <span>{formatDateShort(day)}</span>
            </div>
          ))}
          {HOURS.map((hour) => (
            <Fragment key={hour}>
              <div className="calendar-time">
                {String(hour).padStart(2, "0")}:00
              </div>
              {weekDays.map((day) => (
                <div
                  key={`${day}-${hour}`}
                  className={`calendar-cell ${day === todayIso() ? "today" : ""}`}
                >
                  {coursesForSlot(day, hour).map((course) => {
                    const content = (
                      <>
                        <div className="course-block-top">
                          <strong>
                            {member && isFavorite(course) && (
                              <span className="fav-mark" aria-label="Favorit">
                                ★{" "}
                              </span>
                            )}
                            {course.course_type_name}
                          </strong>
                          <span>{course.start_time}</span>
                        </div>
                        <small>
                          {isOwnAbsentCourse(course, user)
                            ? "krank"
                            : course.trainer_name || "Trainer folgt"}
                        </small>
                        <small className="course-place">
                          {shortStudioName(course.studio_name)}
                        </small>
                        {member && course.status === "active" && (
                          <small className="course-spots">{spotsText(course)}</small>
                        )}
                      </>
                    );
                    const className = `course-block ${courseColorClass(course, user)} ${isBooked(course) ? "booked" : ""}`;
                    return onCourseClick ? (
                      <button
                        key={course.id}
                        type="button"
                        className={className}
                        onClick={() => onCourseClick(course)}
                      >
                        {content}
                      </button>
                    ) : (
                      <div key={course.id} className={className}>
                        {content}
                      </div>
                    );
                  })}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>

      {showTable && (
        <>
          <h3 className="subheading">
            {member ? "Kommende Kurse dieser Woche" : "Alle Kurse dieser Woche"}
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Tag</th>
                  <th>Uhrzeit</th>
                  <th>Kursart</th>
                  <th>Trainer</th>
                  <th>Studio</th>
                  <th>Raum</th>
                  <th>Status</th>
                  {member && <th>Buchung</th>}
                </tr>
              </thead>
              <tbody>
                {tableCourses.map((c) => (
                  <tr key={c.id} className={courseRowClass(c, user)}>
                    <td>{formatDateLong(c.date)}</td>
                    <td>{weekdayName(c.date, true)}</td>
                    <td>
                      {c.start_time}
                      <br />
                      <small>{c.duration_minutes} min</small>
                    </td>
                    <td>{c.course_type_name}</td>
                    <td>{trainerCell(c, user)}</td>
                    <td>{shortStudioName(c.studio_name)}</td>
                    <td>{c.room_name}</td>
                    <td>
                      <CourseStatusBadge course={c} user={user} />
                    </td>
                    {member && (
                      <td>
                        <button
                          className={isBooked(c) || waitingPosition(c) ? "secondary" : ""}
                          disabled={!isBooked(c) && (c.status !== "active" || hasStarted(c))}
                          onClick={() => onCourseClick?.(c)}
                        >
                          {isBooked(c)
                            ? "Gebucht"
                            : waitingPosition(c)
                              ? `Warteliste ${waitingPosition(c)}`
                              : hasStarted(c)
                                ? "Vorbei"
                                : freePlaces(c) === 0
                                  ? "Warteliste"
                                  : "Buchen"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {tableCourses.length === 0 && (
                  <tr>
                    <td colSpan={member ? 9 : 8}>
                      <em>
                        {member
                          ? "Diese Woche stehen keine Kurse mehr an."
                          : "Keine Kurse in dieser Woche gefunden."}
                      </em>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
