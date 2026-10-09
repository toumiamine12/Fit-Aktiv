import { useState } from "react";
import { api } from "./api.js";
import { isAdmin } from "./courses.jsx";
import { formatDateLong, todayIso } from "./format.js";

/** Sick report. Admins pick an employee, trainers report themselves (and end it again). */
export default function AbsenceForm({ data, user, refresh, showError }) {
  const admin = isAdmin(user);
  const [absence, setAbsence] = useState({
    employee_id: "",
    reason: "Krankmeldung",
    start_date: todayIso(),
    end_date: todayIso(),
  });
  const [result, setResult] = useState("");
  const own = (data.employees || []).find((e) => String(e.id) === String(user?.id));
  const set = (key) => (e) => setAbsence({ ...absence, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const targetId = admin ? Number(absence.employee_id) : Number(user?.id);
    if (!targetId) return showError("Bitte Mitarbeiter wählen.");
    try {
      const res = await api.createAbsence(targetId, absence);
      const covered = res.affected_courses.filter((c) => c.replacement).length;
      const cancelled = res.affected_courses.length - covered;
      setResult(
        res.affected_courses.length
          ? `Gespeichert. ${covered} Kurse haben eine Vertretung, ${cancelled} fallen aus. Alle Betroffenen wurden benachrichtigt.`
          : "Gespeichert. In diesem Zeitraum waren keine Kurse geplant.",
      );
      await refresh();
    } catch (err) {
      showError(err.message);
    }
  }

  async function backToWork() {
    try {
      await api.markAvailable(user.id);
      setResult("");
      await refresh();
    } catch (err) {
      showError(err.message);
    }
  }

  if (!admin && own?.status === "unavailable") {
    return (
      <div className="form-card warning absence-card">
        <h3>Sie sind krankgemeldet</h3>
        <p>
          {own.unavailable_reason || "Krankmeldung"}
          {own.unavailable_to ? ` bis ${formatDateLong(own.unavailable_to)}` : ""}. Ihre Kurse in
          dieser Zeit übernehmen Vertretungen oder sie fallen aus.
        </p>
        <button onClick={backToWork}>Ich bin wieder fit</button>
      </div>
    );
  }

  return (
    <form className="form-card warning absence-card" onSubmit={submit}>
      <h3>{admin ? "Krankmeldung eintragen" : "Krank melden"}</h3>
      <p>Für jeden betroffenen Kurs wird automatisch eine Vertretung gesucht.</p>
      {admin && (
        <label>
          Mitarbeiter
          <select value={absence.employee_id} onChange={set("employee_id")}>
            <option value="">Bitte wählen</option>
            {data.employees?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Grund <input value={absence.reason} onChange={set("reason")} />
      </label>
      <div className="absence-dates">
        <label>
          Von <input type="date" value={absence.start_date} onChange={set("start_date")} />
        </label>
        <label>
          Bis <input type="date" value={absence.end_date} onChange={set("end_date")} />
        </label>
      </div>
      <button type="submit">{admin ? "Speichern" : "Krankmeldung senden"}</button>
      {result && (
        <p className="saved-note" role="status">
          {result}
        </p>
      )}
    </form>
  );
}
