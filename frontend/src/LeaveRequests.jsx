import { useState } from "react";
import { api } from "./api.js";
import { isAdmin } from "./courses.jsx";
import { addDays, formatDateLong, toIsoDate } from "./format.js";

const STATUS = {
  pending: ["offen", "orange"],
  approved: ["genehmigt", "green"],
  rejected: ["abgelehnt", "red"],
  withdrawn: ["zurückgezogen", ""],
};

function days(request) {
  return Math.round((new Date(request.end_date) - new Date(request.start_date)) / 86400000) + 1;
}

function Period({ request }) {
  return (
    <span>
      {formatDateLong(request.start_date)} bis {formatDateLong(request.end_date)}
      <small className="muted"> ({days(request) === 1 ? "1 Tag" : `${days(request)} Tage`})</small>
    </span>
  );
}

function StatusBadge({ status }) {
  const [label, tone] = STATUS[status] || [status, ""];
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** Planned leave: trainers request it in advance, the admin approves or rejects it. */
export default function LeaveRequests({ data, user, refresh, showError }) {
  const admin = isAdmin(user);
  const tomorrow = toIsoDate(addDays(new Date(), 1));
  const [form, setForm] = useState({ start_date: tomorrow, end_date: tomorrow, reason: "Urlaub" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const requests = data.leave_requests || [];
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  async function run(action, ...args) {
    setBusy(true);
    setResult("");
    try {
      const res = await action(...args);
      await refresh();
      return res;
    } catch (err) {
      showError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (await run(api.requestLeave, form)) {
      setResult("Antrag gestellt. Die Studioleitung entscheidet und Sie erhalten eine Nachricht.");
    }
  }

  async function decide(request, approve) {
    const res = await run(api.decideLeave, request.id, approve);
    if (res && approve) {
      const covered = res.affected_courses.filter((c) => c.replacement).length;
      const cancelled = res.affected_courses.length - covered;
      setResult(
        res.affected_courses.length
          ? `${request.employee_name}: genehmigt. ${covered} Kurse haben eine Vertretung, ${cancelled} fallen aus. Alle Betroffenen wurden benachrichtigt.`
          : `${request.employee_name}: genehmigt. In diesem Zeitraum waren keine Kurse geplant.`,
      );
    } else if (res) {
      setResult(`${request.employee_name}: abgelehnt.`);
    }
  }

  if (admin) {
    return (
      <section className="panel leave-panel">
        <div className="profile-box-head">
          <h2>Urlaubsanträge</h2>
          <span className="muted">{pending.length ? `${pending.length} offen` : "keine offenen Anträge"}</span>
        </div>
        {result && (
          <p className="saved-note" role="status">
            {result}
          </p>
        )}
        {pending.length > 0 && (
          <ul className="leave-list">
            {pending.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.employee_name}</strong>
                  <span className="muted">
                    {r.reason}, {r.studio_name.replace(/^Studio /, "")}
                  </span>
                </div>
                <Period request={r} />
                <div className="leave-actions">
                  <button disabled={busy} onClick={() => decide(r, true)}>
                    Genehmigen
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => decide(r, false)}>
                    Ablehnen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted leave-hint">
          Beim Genehmigen sucht das System für jeden Kurs im Zeitraum automatisch eine Vertretung, genau wie bei einer
          Krankmeldung.
        </p>
        {decided.length > 0 && (
          <details className="leave-history">
            <summary>Entschiedene Anträge ({decided.length})</summary>
            <ul className="leave-list">
              {decided.slice(0, 20).map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.employee_name}</strong>
                    <span className="muted">{r.reason}</span>
                  </div>
                  <Period request={r} />
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    );
  }

  return (
    <section className="panel leave-panel">
      <h2>Urlaub beantragen</h2>
      <p className="muted">
        Frühestens ab morgen, bis zu 30 Tage pro Antrag. Nach der Genehmigung werden Ihre Kurse in diesem Zeitraum
        automatisch vertreten.
      </p>
      <form className="leave-form" onSubmit={submit}>
        <label>
          Von
          <input
            type="date"
            min={tomorrow}
            required
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: e.target.value > form.end_date ? e.target.value : form.end_date })}
          />
        </label>
        <label>
          Bis
          <input
            type="date"
            min={form.start_date}
            required
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          />
        </label>
        <label>
          Grund
          <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
            <option>Urlaub</option>
            <option>Fortbildung</option>
            <option>Sonderurlaub</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>
          Antrag stellen
        </button>
      </form>
      {result && (
        <p className="saved-note" role="status">
          {result}
        </p>
      )}
      {requests.length > 0 && (
        <ul className="leave-list">
          {requests.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.reason}</strong>
              </div>
              <Period request={r} />
              {r.status === "pending" ? (
                <div className="leave-actions">
                  <StatusBadge status={r.status} />
                  <button className="secondary" disabled={busy} onClick={() => run(api.withdrawLeave, r.id)}>
                    Zurückziehen
                  </button>
                </div>
              ) : (
                <StatusBadge status={r.status} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
