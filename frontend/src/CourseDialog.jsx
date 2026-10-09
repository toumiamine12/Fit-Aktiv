import { useEffect, useState } from "react";
import { api } from "./api.js";
import { CourseStatusBadge, courseColorClass, isAdmin, trainerCell } from "./courses.jsx";
import { formatDateLong, hasStarted, weekdayName } from "./format.js";

/** Course details for staff: who teaches, who is coming, a message to participants, and admin actions. */
export default function StaffCourseDialog({ course, user, refresh, showError, onClose }) {
  const [participants, setParticipants] = useState(null);
  const admin = isAdmin(user);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState("");
  const canMessage =
    (admin || String(course.trainer_id) === String(user.id)) &&
    course.status !== "cancelled" &&
    !hasStarted(course) &&
    course.booked_count > 0;

  useEffect(() => {
    api
      .getParticipants(course.id)
      .then((res) => setParticipants(res.participants))
      .catch(() => setParticipants([]));
  }, [course.id]);

  async function send(e) {
    e.preventDefault();
    try {
      const res = await api.messageParticipants(course.id, message);
      setSent(`Gesendet an ${res.recipients} Teilnehmer.`);
      setMessage("");
    } catch (err) {
      showError(err.message);
    }
  }

  async function cancel() {
    if (!confirm(`${course.course_type_name} wirklich ausfallen lassen? Gebuchte Mitglieder werden benachrichtigt.`)) return;
    try {
      await api.cancelCourse(course.id);
      await refresh();
      onClose();
    } catch (e) {
      showError(e.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal booking-modal ${courseColorClass(course, user)}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-course-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="staff-course-title">{course.course_type_name}</h2>
        <dl className="booking-facts">
          <div>
            <dt>Wann</dt>
            <dd>
              {weekdayName(course.date, true)}, {formatDateLong(course.date)}, {course.start_time} Uhr (
              {course.duration_minutes} Min.)
            </dd>
          </div>
          <div>
            <dt>Wo</dt>
            <dd>
              {course.studio_name}, {course.room_name}
            </dd>
          </div>
          <div>
            <dt>Trainer</dt>
            <dd>{trainerCell(course, user)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <CourseStatusBadge course={course} user={user} />
            </dd>
          </div>
          <div>
            <dt>Teilnehmer</dt>
            <dd>
              <small className="block">
                {course.booked_count || 0} von {course.capacity} Plätzen gebucht
              </small>
              {participants === null
                ? "wird geladen"
                : participants.length
                  ? participants.join(", ")
                  : "Noch niemand gebucht."}
            </dd>
          </div>
        </dl>
        {canMessage && (
          <form className="course-message" onSubmit={send}>
            <label>
              Nachricht an alle Teilnehmer
              <textarea
                rows={3}
                maxLength={500}
                placeholder="Zum Beispiel: Bitte bringt heute ein Handtuch mit."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setSent("");
                }}
              />
            </label>
            <div className="course-message-actions">
              <small>{message.length} / 500</small>
              <button type="submit" disabled={!message.trim()}>
                Nachricht senden
              </button>
            </div>
            {sent && (
              <p className="saved-note" role="status">
                {sent}
              </p>
            )}
          </form>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Schließen
          </button>
          {admin && course.status !== "cancelled" && !hasStarted(course) && (
            <button className="danger" onClick={cancel}>
              Kurs ausfallen lassen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
