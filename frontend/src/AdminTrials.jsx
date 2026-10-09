import { useEffect, useState } from "react";
import { api } from "./api.js";
import { formatDateLong, shortStudioName } from "./format.js";

const STATUS = {
  neu: ["Neu", "orange"],
  kontaktiert: ["Kontaktiert", ""],
  erledigt: ["Erledigt", "green"],
};
const NEXT = { neu: ["kontaktiert", "Als kontaktiert markieren"], kontaktiert: ["erledigt", "Als erledigt markieren"] };

/** Trial-session requests from the website, with a simple processing status. */
export default function AdminTrials({ showError }) {
  const [requests, setRequests] = useState(null);
  const [filter, setFilter] = useState("offen");

  useEffect(() => {
    api.adminTrials().then((res) => setRequests(res.requests)).catch((e) => showError(e.message));
  }, [showError]);

  async function setStatus(r, status) {
    try {
      await api.adminUpdateTrial(r.id, status);
      setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status } : x)));
    } catch (e) {
      showError(e.message);
    }
  }

  if (!requests) return <p className="muted">Anfragen werden geladen.</p>;

  const counts = { offen: requests.filter((r) => r.status !== "erledigt").length, erledigt: 0, alle: requests.length };
  counts.erledigt = counts.alle - counts.offen;
  const shown = requests.filter((r) =>
    filter === "alle" ? true : filter === "erledigt" ? r.status === "erledigt" : r.status !== "erledigt",
  );

  return (
    <section className="admin-trials">
      <div className="admin-filters" role="tablist" aria-label="Filter">
        {[
          ["offen", "Offen"],
          ["erledigt", "Erledigt"],
          ["alle", "Alle"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            className={`studio-chip ${filter === key ? "active" : ""}`}
            onClick={() => setFilter(key)}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {shown.length ? (
        <ul className="admin-trial-list">
          {shown.map((r) => {
            const [label, tone] = STATUS[r.status] || [r.status, ""];
            return (
              <li key={r.id} className="panel">
                <div className="admin-trial-head">
                  <div>
                    <strong>{r.name}</strong>
                    <span className="muted">
                      Eingegangen am {formatDateLong(r.created_at.slice(0, 10))}, {r.created_at.slice(11, 16)} Uhr
                    </span>
                  </div>
                  <span className={`badge ${tone}`}>{label}</span>
                </div>
                <dl className="admin-trial-facts">
                  <div>
                    <dt>E-Mail</dt>
                    <dd className="selectable">{r.email}</dd>
                  </div>
                  <div>
                    <dt>Telefon</dt>
                    <dd className="selectable">{r.phone || "nicht angegeben"}</dd>
                  </div>
                  <div>
                    <dt>Studio</dt>
                    <dd>{r.studio_name ? shortStudioName(r.studio_name) : "egal"}</dd>
                  </div>
                  <div>
                    <dt>Kurs</dt>
                    <dd>{r.course_type_name || "egal"}</dd>
                  </div>
                  <div>
                    <dt>Wunschtermin</dt>
                    <dd>{r.preferred_date ? formatDateLong(r.preferred_date) : "flexibel"}</dd>
                  </div>
                </dl>
                {r.message && <p className="admin-trial-message">„{r.message}“</p>}
                <div className="admin-trial-actions">
                  {NEXT[r.status] && <button onClick={() => setStatus(r, NEXT[r.status][0])}>{NEXT[r.status][1]}</button>}
                  {r.status !== "neu" && (
                    <button className="secondary" onClick={() => setStatus(r, "neu")}>
                      Wieder öffnen
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{filter === "offen" ? "Alle Anfragen sind bearbeitet." : "Keine Anfragen."}</p>
      )}
    </section>
  );
}
