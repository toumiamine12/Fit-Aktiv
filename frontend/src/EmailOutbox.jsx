import { useEffect, useState } from "react";
import { api } from "./api.js";
import { formatDateLong } from "./format.js";

/**
 * Admin view of the local email outbox. The demo sends no real mail: every email the system would send
 * (waiting list, trainer change, cancellation) is stored and shown here.
 */
export default function EmailOutbox({ showError }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.emails().then(setState).catch((err) => showError(err.message));
  }, [showError]);

  if (!state) return <p className="muted">E-Mails werden geladen.</p>;

  return (
    <section className="panel wide outbox">
      <div className="profile-box-head">
        <h2>E-Mail-Postausgang</h2>
        <span className="muted">{state.total} E-Mails</span>
      </div>
      <p className="muted outbox-note">
        Lokale Demo: E-Mails werden nicht verschickt, sondern hier gespeichert. So sieht man genau, was Mitglieder bei
        Nachrücken, Trainerwechsel oder Kursausfall bekommen würden.
      </p>
      {state.emails.length ? (
        <ul className="outbox-list">
          {state.emails.map((m) => (
            <li key={m.id}>
              <button className="outbox-row" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                <strong>{m.subject}</strong>
                <span>
                  An {m.member_name} &lt;{m.to_address}&gt;
                </span>
                <small className="muted">
                  {formatDateLong(m.created_at.slice(0, 10))}, {m.created_at.slice(11, 16)} Uhr
                </small>
              </button>
              {open === m.id && <pre className="outbox-body">{m.body}</pre>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Noch keine E-Mails. Sie entstehen zum Beispiel, wenn ein Kurs ausfällt oder jemand nachrückt.</p>
      )}
    </section>
  );
}
