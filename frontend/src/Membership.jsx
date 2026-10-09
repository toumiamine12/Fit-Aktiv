import { useState } from "react";
import { api } from "./api.js";
import { formatDateLong, toIsoDate } from "./format.js";

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function monthStart(date, plus = 0) {
  return new Date(date.getFullYear(), date.getMonth() + plus, 1);
}

function monthLabel(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function euro(value) {
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** Months covered by a pause, as "YYYY-MM" keys. */
function pauseMonths(pause) {
  const first = new Date(`${pause.start_month}T12:00:00`);
  return Array.from({ length: pause.months }, (_, i) => toIsoDate(monthStart(first, i)).slice(0, 7));
}

/** Shared state and actions for the three membership boxes. */
function useMembership(data, refresh, showError) {
  const [busy, setBusy] = useState(false);
  async function run(action, ...args) {
    setBusy(true);
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
  const me = data.me || {};
  const plans = data.memberships || {};
  return { me, plans, busy, run, today: new Date(), nextMonth: toIsoDate(monthStart(new Date(), 1)) };
}

/** Current plan, member since, status and a pending plan change. */
export function MembershipSummary({ data, refresh, showError }) {
  const { me, plans, busy, run, today } = useMembership(data, refresh, showError);
  const plan = plans[me.membership_type] || {};
  const pending = me.pending_membership_type && plans[me.pending_membership_type];
  const since = me.member_since ? new Date(`${me.member_since}T12:00:00`) : today;
  const months = (today.getFullYear() - since.getFullYear()) * 12 + today.getMonth() - since.getMonth();
  return (
    <section className="panel profile-box membership-summary">
      <div className="profile-box-head">
        <h2>Ihre Mitgliedschaft</h2>
        <span className={`badge ${me.paused_now ? "orange" : "green"}`}>{me.paused_now ? "pausiert" : "aktiv"}</span>
      </div>
      <p className="membership-plan">
        {plan.name} <small>{plan.price ? `${euro(plan.price)} im Monat` : ""}</small>
      </p>
      <dl className="profile-facts">
        <div>
          <dt>Mitglied seit</dt>
          <dd>{monthLabel(me.member_since || toIsoDate(today))}</dd>
        </div>
        <div>
          <dt>Dauer</dt>
          <dd>{months === 1 ? "1 Monat" : `${months} Monate`}</dd>
        </div>
        <div>
          <dt>Leistungen</dt>
          <dd>{(plan.features || []).join(", ")}</dd>
        </div>
      </dl>
      {pending && (
        <div className="membership-pending">
          <span>
            Ab {formatDateLong(me.pending_from)}: <strong>{pending.name}</strong> ({euro(pending.price)} im Monat)
          </span>
          <button className="secondary" disabled={busy} onClick={() => run(api.withdrawMembershipChange)}>
            Zurücknehmen
          </button>
        </div>
      )}
    </section>
  );
}

/** The four plans; a change applies from the 1st of next month. */
export function PlanChange({ data, refresh, showError }) {
  const { me, plans, busy, run, nextMonth } = useMembership(data, refresh, showError);
  return (
    <section className="panel profile-box">
      <div className="profile-box-head">
        <h2>Tarif wechseln</h2>
        <span className="muted">Gilt immer ab dem 1. des nächsten Monats</span>
      </div>
      <div className="plan-grid">
        {Object.entries(plans).map(([key, p]) => {
          const current = key === me.membership_type;
          const chosen = key === me.pending_membership_type;
          return (
            <article key={key} className={`plan-card ${current ? "current" : ""} ${chosen ? "chosen" : ""}`}>
              <h4>{p.name}</h4>
              <p className="plan-price">
                {euro(p.price)} <small>/ Monat</small>
              </p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {current ? (
                <span className="plan-tag">Ihr Tarif</span>
              ) : chosen ? (
                <span className="plan-tag">Ab {formatDateLong(me.pending_from).slice(0, 6)}</span>
              ) : (
                <button disabled={busy} onClick={() => run(api.changeMembership, key)}>
                  Ab {formatDateLong(nextMonth).slice(0, 6)} wechseln
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Membership pauses: whole months, from next month on, max. 3 months per calendar year. */
export function PauseBox({ data, refresh, showError }) {
  const { me, busy, run, today, nextMonth } = useMembership(data, refresh, showError);
  const maxPause = data.max_pause_months ?? 3;
  const [pauseStart, setPauseStart] = useState(nextMonth);
  const [pauseLength, setPauseLength] = useState(1);
  const pauses = me.pauses || [];
  const usedIn = (year) => pauses.flatMap(pauseMonths).filter((m) => m.startsWith(`${year}-`)).length;
  const startOptions = Array.from({ length: 12 }, (_, i) => toIsoDate(monthStart(today, i + 1)));
  const years = [today.getFullYear(), today.getFullYear() + 1];

  async function requestPause(e) {
    e.preventDefault();
    const until = toIsoDate(monthStart(new Date(`${pauseStart}T12:00:00`), pauseLength - 1));
    if (
      !confirm(
        `Mitgliedschaft von ${monthLabel(pauseStart)} bis ${monthLabel(until)} pausieren? ` +
          "Gebuchte Kurse in dieser Zeit werden storniert.",
      )
    )
      return;
    const res = await run(api.addPause, pauseStart, Number(pauseLength));
    if (res?.released_bookings) alert(`${res.released_bookings} Buchungen in der Pause wurden storniert.`);
  }

  return (
    <section className="panel profile-box">
      <h2>Mitgliedschaft pausieren</h2>
      <p className="muted">Bis zu {maxPause} Monate pro Kalenderjahr, frühestens ab nächstem Monat.</p>
      <div className="pause-usage">
        {years.map((y) => (
          <div key={y}>
            <span>{y}</span>
            <div className="occupancy-bar">
              <span style={{ width: `${(usedIn(y) / maxPause) * 100}%` }} />
            </div>
            <small>
              {usedIn(y)} von {maxPause} Monaten
            </small>
          </div>
        ))}
      </div>
      <form className="pause-form" onSubmit={requestPause}>
        <label>
          Ab
          <select value={pauseStart} onChange={(e) => setPauseStart(e.target.value)}>
            {startOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dauer
          <select value={pauseLength} onChange={(e) => setPauseLength(Number(e.target.value))}>
            {Array.from({ length: maxPause }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 Monat" : `${n} Monate`}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy}>
          Pause beantragen
        </button>
      </form>
      {pauses.length > 0 && (
        <ul className="pause-list">
          {pauses.map((p) => {
            const keys = pauseMonths(p);
            const future = p.start_month > toIsoDate(today);
            return (
              <li key={p.id}>
                <span>
                  {monthLabel(`${keys[0]}-01`)}
                  {keys.length > 1 && ` bis ${monthLabel(`${keys[keys.length - 1]}-01`)}`}
                  <small> ({keys.length === 1 ? "1 Monat" : `${keys.length} Monate`})</small>
                </span>
                {future ? (
                  <button className="secondary" disabled={busy} onClick={() => run(api.deletePause, p.id)}>
                    Zurücknehmen
                  </button>
                ) : (
                  <span className="muted">läuft oder vorbei</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
