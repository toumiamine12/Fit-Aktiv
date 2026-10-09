import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api } from "./api.js";
import { formatDateLong, formatDateShort, shortStudioName, todayIso, weekdayName } from "./format.js";

const PLANS = { basic: "Basic", plus: "Plus", premium: "Premium", young: "Young" };
const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const euro = (v) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const percent = (v) => `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
}

/** Start page of the admin portal: what needs a decision, money, operations and people. */
export default function AdminOverview({ user, setPage, showError }) {
  const [o, setO] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.adminOverview().then(setO).catch((e) => showError(e.message));
    api.stats().then(setStats).catch(() => setStats(null));
  }, [showError]);

  if (!o) return <p className="muted">Übersicht wird geladen.</p>;

  const today = todayIso();
  const tasks = [
    {
      key: "leave",
      count: o.pending_leave.length,
      title: o.pending_leave.length === 1 ? "Urlaubsantrag" : "Urlaubsanträge",
      done: "Urlaubsanträge",
      action: "Entscheiden",
      page: "Zeiten",
      lines: o.pending_leave.map(
        (l) => `${l.employee_name}: ${l.reason}, ${formatDateShort(l.start_date)} bis ${formatDateShort(l.end_date)}`,
      ),
    },
    {
      key: "courses",
      count: o.open_courses.length,
      title: "Kurse ohne Trainer in den nächsten 14 Tagen",
      done: "Kurse ohne Trainer",
      action: "Vertretung suchen",
      page: "Kurse",
      lines: o.open_courses.map(
        (c) =>
          `${weekdayName(c.date)} ${formatDateShort(c.date)}, ${c.start_time} ${c.course_type_name}, ${shortStudioName(c.studio_name)} (${c.booked} gebucht)`,
      ),
    },
    {
      key: "trials",
      count: o.trials.length,
      title: o.trials.length === 1 ? "neue Probetraining-Anfrage" : "neue Probetraining-Anfragen",
      done: "Probetraining-Anfragen",
      action: "Anfragen öffnen",
      page: "Probetraining",
      lines: o.trials.map((t) => `${t.name}, ${shortStudioName(t.studio_name || "")}`),
    },
    {
      key: "messages",
      count: o.unread,
      title: o.unread === 1 ? "ungelesene Nachricht" : "ungelesene Nachrichten",
      done: "Nachrichten",
      action: "Lesen",
      page: "Benachrichtigungen",
      lines: [],
    },
  ];
  const open = tasks.filter((t) => t.count > 0);
  const done = tasks.filter((t) => t.count === 0);
  const f = o.finance;
  const costShare = f.revenue ? Math.min(1, f.costs / f.revenue) : 0;
  const monthLabel = MONTHS[Number(today.slice(5, 7)) - 1];

  return (
    <section className="ov">
      <header className="ov-head">
        <h1>
          {greeting()}, {user.name}.
        </h1>
        <p>
          {weekdayName(today, true)}, {formatDateLong(today)}
        </p>
      </header>

      <div className="ov-layout">
        <div className="ov-main">
          <section className="panel ov-tasks">
            <h2>{open.length ? "Wartet auf Sie" : "Alles erledigt"}</h2>
            {open.length > 0 && (
              <ul>
                {open.map((t) => (
                  <li key={t.key}>
                    <div className="ov-task-text">
                      <strong>
                        <span className="ov-count">{t.count}</span> {t.title}
                      </strong>
                      {t.lines.slice(0, 3).map((line) => (
                        <small key={line}>{line}</small>
                      ))}
                      {t.lines.length > 3 && <small className="muted">und {t.lines.length - 3} weitere</small>}
                    </div>
                    <button className="secondary" onClick={() => setPage(t.page)}>
                      {t.action} <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {done.length > 0 && <p className="ov-done">Nichts offen bei: {done.map((t) => t.done).join(", ")}.</p>}
          </section>

          <section className="panel ov-money">
            <div className="ov-section-head">
              <h2>Finanzen {monthLabel}</h2>
              <button className="text-link" onClick={() => setPage("Finanzbericht")}>
                Finanzbericht
              </button>
            </div>
            <div className="ov-money-figures">
              <div>
                <span>Erlöse netto</span>
                <strong>{euro(f.revenue)}</strong>
              </div>
              <div>
                <span>Kosten</span>
                <strong>{euro(f.costs)}</strong>
                <small>davon Personal {euro(f.personnel)}</small>
              </div>
              <div>
                <span>Betriebsergebnis</span>
                <strong className={f.result < 0 ? "neg" : "pos"}>{euro(f.result)}</strong>
                <small>{f.revenue ? percent(f.result / f.revenue) : "–"} der Erlöse</small>
              </div>
            </div>
            <div className="ov-split" aria-hidden="true">
              <span className="cost" style={{ width: `${costShare * 100}%` }} />
              <span className="result" style={{ width: `${(1 - costShare) * 100}%` }} />
            </div>
            <p className="muted ov-note">Laufender Monat: Gehälter, Miete und Energie voll, übrige Kosten soweit erfasst.</p>
          </section>

          <section className="panel ov-ops">
            <h2>Betrieb</h2>
            <div className="ov-ops-grid">
              <dl>
                <dt>Heute</dt>
                <dd>
                  <strong>{o.today.courses}</strong> Kurse
                </dd>
                <dd className="muted">
                  {o.today.present} von {o.today.booked} Teilnehmern eingecheckt
                </dd>
              </dl>
              <dl>
                <dt>Diese Woche</dt>
                <dd>
                  <strong>{o.week.active}</strong> Kurse geplant
                </dd>
                <dd className={o.week.cancelled ? "warn" : "muted"}>{o.week.cancelled} ausgefallen</dd>
                <dd className={o.week.open ? "warn" : "muted"}>{o.week.open} ohne Trainer</dd>
              </dl>
              <dl>
                <dt>Mitglieder</dt>
                <dd>
                  <strong>{stats ? stats.members_total.toLocaleString("de-DE") : "–"}</strong> gesamt
                </dd>
                <dd className="muted">{o.new_members_month} neu im {monthLabel}</dd>
                <dd className="muted">
                  {o.plan_changes.count} Tarifwechsel ab {formatDateShort(o.plan_changes.from)} (
                  {o.plan_changes.effect >= 0 ? "+" : ""}
                  {euro(o.plan_changes.effect)} / Monat)
                </dd>
                <dd className="muted">{o.pauses_next_month} Pausen ab nächstem Monat</dd>
              </dl>
            </div>
            <div className="ov-ops-grid two">
              <div>
                <h3>Studio-Auslastung</h3>
                <p className="muted ov-note">Beste und schwächste, letzte 4 Wochen</p>
                <ul className="ov-rank">
                  {o.studios_high.map((st) => (
                    <li key={`h-${st.name}`}>
                      <span>{shortStudioName(st.name)}</span>
                      <strong>{percent(st.rate)}</strong>
                    </li>
                  ))}
                  <li className="ov-rank-gap" aria-hidden="true" />
                  {o.studios_low.map((st) => (
                    <li key={`l-${st.name}`} className="low">
                      <span>{shortStudioName(st.name)}</span>
                      <strong>{percent(st.rate)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Trainer diese Woche</h3>
                {o.trainers_full.length ? (
                  <ul className="ov-rank">
                    {o.trainers_full.map((tr) => (
                      <li key={tr.name}>
                        <span>{tr.name}</span>
                        <strong>
                          {tr.courses}/{tr.max}
                        </strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted ov-note">Niemand ist an seiner Wochengrenze.</p>
                )}
                <p className="ov-note">
                  {o.trainers_idle_count} verfügbare Trainer haben höchstens einen Kurs und stehen für Vertretungen bereit.
                </p>
              </div>
            </div>
          </section>
        </div>

        <aside className="panel ov-side">
          <section>
            <div className="ov-section-head">
              <h2>Krankgemeldet</h2>
              <span className="muted">{o.sick.length}</span>
            </div>
            {o.sick.length ? (
              <ul className="ov-list">
                {o.sick.map((s) => (
                  <li key={s.id}>
                    <span>{s.name}</span>
                    <small className="muted">
                      {shortStudioName(s.studio_name)}
                      {s.unavailable_to ? `, bis ${formatDateShort(s.unavailable_to)}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Alle Mitarbeiter sind im Dienst.</p>
            )}
          </section>

          <section>
            <div className="ov-section-head">
              <h2>Neueste Mitglieder</h2>
              <button className="text-link" onClick={() => setPage("Mitglieder")}>
                Alle
              </button>
            </div>
            <ul className="ov-list">
              {o.newest_members.map((m) => (
                <li key={m.id}>
                  <span>{m.name}</span>
                  <small className="muted">
                    {PLANS[m.membership_type]}, {shortStudioName(m.studio_name || "")}
                  </small>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Kritische Bewertungen</h2>
            <p className="muted ov-note">1 oder 2 Sterne, letzte 30 Tage</p>
            {o.low_ratings.length ? (
              <ul className="ov-list">
                {o.low_ratings.map((rt, i) => (
                  <li key={i}>
                    <span>
                      {"★".repeat(rt.stars)} {rt.course_type_name}, {formatDateShort(rt.date)}
                    </span>
                    <small className="muted">
                      {rt.trainer_name || "ohne Trainer"}, {shortStudioName(rt.studio_name)}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Keine schlechten Bewertungen.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
