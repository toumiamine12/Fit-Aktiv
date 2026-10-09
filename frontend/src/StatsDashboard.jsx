import { useEffect, useState } from "react";
import { api } from "./api.js";
import { shortStudioName } from "./format.js";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const COST_LABELS = {
  salaries: "Löhne und Gehälter",
  social: "Sozialabgaben (AG)",
  rent: "Miete",
  energy: "Energie",
  reinigung: "Reinigung",
  wartung: "Wartung",
  reparatur: "Reparaturen",
  geraete: "Geräte",
  marketing: "Werbung",
  verwaltung: "Verwaltung und IT",
  sonstiges: "Sonstiges",
};

const euro = (v) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const kEuro = (v) => `${(v / 1000).toLocaleString("de-DE", { maximumFractionDigits: 0 })} T€`;
const percent = (v) => `${(v * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
const monthShort = (iso) => MONTHS[Number(iso.slice(5, 7)) - 1];

function Kpi({ label, value, note, tone }) {
  return (
    <div className="st-kpi">
      <span>{label}</span>
      <strong className={tone || ""}>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function FinanceTab({ stats, setPage }) {
  const months = stats.revenue;
  const now = months[months.length - 1];
  const prev = months[months.length - 2];
  const peak = Math.max(...months.map((m) => Math.max(m.revenue_net, m.costs)), 1);
  const costs = Object.entries(stats.cost_breakdown)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const totalCosts = costs.reduce((s, [, v]) => s + v, 0);
  const personnel = (stats.cost_breakdown.salaries || 0) + (stats.cost_breakdown.social || 0);
  const margin = now.revenue_net ? now.result / now.revenue_net : 0;

  return (
    <>
      <div className="st-kpis">
        <Kpi label={`Erlöse netto, ${monthShort(now.month)}`} value={euro(now.revenue_net)} note={`brutto ${euro(now.revenue)}`} />
        <Kpi label="Kosten" value={euro(now.costs)} note={`davon Personal ${euro(personnel)}`} />
        <Kpi
          label="Betriebsergebnis"
          value={euro(now.result)}
          tone={now.result < 0 ? "neg" : "pos"}
          note={prev ? `Vormonat ${euro(prev.result)}` : ""}
        />
        <Kpi label="Umsatzrendite" value={percent(margin)} note="Ergebnis in % der Erlöse" />
      </div>

      <div className="st-grid">
        <section className="panel st-span">
          <div className="st-head">
            <div>
              <h2>Erlöse, Kosten und Ergebnis</h2>
              <p className="muted">Letzte sechs Monate, netto. Zahl unter den Balken: Betriebsergebnis.</p>
            </div>
            <div className="st-legend">
              <span>
                <i className="lg-rev" /> Erlöse
              </span>
              <span>
                <i className="lg-cost" /> Kosten
              </span>
            </div>
          </div>
          <div className="st-pairs" role="img" aria-label="Erlöse und Kosten der letzten sechs Monate">
            {months.map((m) => (
              <div key={m.month} className="st-pair">
                <div className="st-pair-bars">
                  <span className="st-bar rev" style={{ height: `${(m.revenue_net / peak) * 100}%` }} title={`Erlöse ${euro(m.revenue_net)}`} />
                  <span className="st-bar cost" style={{ height: `${(m.costs / peak) * 100}%` }} title={`Kosten ${euro(m.costs)}`} />
                </div>
                <strong className={m.result < 0 ? "neg" : ""}>{kEuro(m.result)}</strong>
                <small>{monthShort(m.month)}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Kostenstruktur, {monthShort(now.month)}</h2>
          <div className="st-stack" aria-hidden="true">
            {costs.map(([k, v]) => (
              <span key={k} className={`c-${k}`} style={{ width: `${(v / totalCosts) * 100}%` }} />
            ))}
          </div>
          <ul className="st-costs">
            {costs.map(([k, v]) => (
              <li key={k}>
                <i className={`c-${k}`} />
                <span>{COST_LABELS[k] || k}</span>
                <strong>{euro(v)}</strong>
                <small>{percent(v / totalCosts)}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Finanzbericht</h2>
          <p className="muted">
            BWA mit Erfolgsrechnung, Kostenstellen und Umsatzsteuer, als PDF für die Buchhaltung. Dort werden auch
            Ausgaben wie Wartung und Reparaturen erfasst.
          </p>
          <button onClick={() => setPage("Finanzbericht")}>Zum Finanzbericht</button>
          <dl className="admin-facts st-central">
            <div>
              <dt>Zentrale Kosten im Monat</dt>
              <dd>{euro(stats.central_costs)}</dd>
            </div>
            <div>
              <dt>Personalkostenquote</dt>
              <dd>{percent(now.revenue_net ? personnel / now.revenue_net : 0)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel st-span">
          <h2>Ergebnis pro Studio</h2>
          <p className="muted">{monthShort(now.month)}, netto, vor zentralen Kosten.</p>
          <div className="table-wrap">
            <table className="st-table">
              <thead>
                <tr>
                  <th>Studio</th>
                  <th>Erlöse</th>
                  <th>Personal</th>
                  <th>Kosten gesamt</th>
                  <th>Ergebnis</th>
                  <th>Marge</th>
                </tr>
              </thead>
              <tbody>
                {stats.studio_results.map((s) => {
                  const m = s.revenue ? s.result / s.revenue : 0;
                  return (
                    <tr key={s.name}>
                      <td>{shortStudioName(s.name)}</td>
                      <td>{euro(s.revenue)}</td>
                      <td>{euro(s.personnel)}</td>
                      <td>{euro(s.costs)}</td>
                      <td className={s.result < 0 ? "neg" : ""}>{euro(s.result)}</td>
                      <td className="st-meter-cell">
                        <span className="st-meter">
                          <span style={{ width: `${Math.max(0, Math.min(100, m * 100 * 2))}%` }} />
                        </span>
                        {percent(m)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted st-foot">Balken: Marge, voller Balken entspricht 50 %.</p>
        </section>
      </div>
    </>
  );
}

function MembersTab({ stats }) {
  const months = stats.revenue;
  const now = months[months.length - 1];
  const plans = Object.values(stats.plans);
  const planTotal = plans.reduce((s, p) => s + p.members, 0) || 1;
  const newPeak = Math.max(...months.map((m) => m.new_members), 1);
  const avgFee = now.members ? now.revenue / now.members : 0;

  return (
    <>
      <div className="st-kpis">
        <Kpi label="Mitglieder" value={stats.members_total.toLocaleString("de-DE")} note={`${now.members.toLocaleString("de-DE")} zahlen diesen Monat`} />
        <Kpi label={`Neu im ${monthShort(now.month)}`} value={now.new_members.toLocaleString("de-DE")} />
        <Kpi label="Pausiert" value={stats.paused_now.toLocaleString("de-DE")} note="in diesem Monat beitragsfrei" />
        <Kpi label="Ø Monatsbeitrag" value={avgFee.toLocaleString("de-DE", { style: "currency", currency: "EUR" })} note="brutto" />
      </div>
      <div className="st-grid">
        <section className="panel">
          <h2>Neue Mitglieder pro Monat</h2>
          <div className="st-columns" role="img" aria-label="Neue Mitglieder der letzten sechs Monate">
            {months.map((m) => (
              <div key={m.month} className="st-col">
                <strong>{m.new_members}</strong>
                <span className="st-bar rev" style={{ height: `${(m.new_members / newPeak) * 100}%` }} />
                <small>{monthShort(m.month)}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Tarife</h2>
          <div className="st-stack" aria-hidden="true">
            {plans.map((p, i) => (
              <span key={p.name} className={`p-${i}`} style={{ width: `${(p.members / planTotal) * 100}%` }} />
            ))}
          </div>
          <ul className="st-costs">
            {plans.map((p, i) => (
              <li key={p.name}>
                <i className={`p-${i}`} />
                <span>
                  {p.name} <small className="muted">({euro(p.price)})</small>
                </span>
                <strong>{p.members.toLocaleString("de-DE")}</strong>
                <small>{percent(p.members / planTotal)}</small>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function CoursesTab({ stats }) {
  const occupancy = stats.occupancy
    .map((s) => ({ ...s, rate: s.seats ? s.booked / s.seats : 0 }))
    .sort((a, b) => b.rate - a.rate);
  const seats = occupancy.reduce((s, x) => s + x.seats, 0);
  const booked = occupancy.reduce((s, x) => s + x.booked, 0);
  const heat = new Map(stats.busiest.map((b) => [`${b.weekday}-${b.hour}`, b.avg]));
  const heatPeak = Math.max(...stats.busiest.map((b) => b.avg), 1);
  const busiest = [...stats.busiest].sort((a, b) => b.avg - a.avg)[0];

  return (
    <>
      <div className="st-kpis">
        <Kpi label="Auslastung" value={percent(seats ? booked / seats : 0)} note="letzte 4 Wochen" />
        <Kpi label="No-Shows" value={percent(stats.no_show_rate)} note="gebucht, nicht erschienen" />
        <Kpi label="Stornoquote" value={percent(stats.cancellation_rate)} />
        <Kpi label="Bewertung" value={`★ ${(stats.avg_rating || 0).toLocaleString("de-DE")}`} note={`${stats.rating_count} Bewertungen`} />
      </div>
      <div className="st-grid">
        <section className="panel">
          <h2>Stoßzeiten</h2>
          <p className="muted">
            Ø gebuchte Plätze pro Kurs. Am vollsten: {busiest ? `${WEEKDAYS[busiest.weekday]} ${busiest.hour}:00 Uhr` : "–"}.
          </p>
          <div className="stats-heat">
            <span />
            {HOURS.map((h) => (
              <small key={h} className="stats-heat-hour">
                {h}
              </small>
            ))}
            {WEEKDAYS.map((day, wd) => (
              <div key={day} className="stats-heat-row">
                <small>{day}</small>
                {HOURS.map((h) => {
                  const v = heat.get(`${wd}-${h}`);
                  return (
                    <span
                      key={h}
                      className="stats-heat-cell"
                      title={v === undefined ? `${day} ${h}:00, kein Kurs` : `${day} ${h}:00, Ø ${v.toLocaleString("de-DE")} Plätze`}
                      style={{ "--level": v === undefined ? 0 : 0.12 + (v / heatPeak) * 0.88 }}
                      data-empty={v === undefined ? "" : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>Kursarten</h2>
          <p className="muted">Letzte 4 Wochen.</p>
          <div className="table-wrap">
            <table className="st-table">
              <thead>
                <tr>
                  <th>Kursart</th>
                  <th>Kurse</th>
                  <th>Buchungen</th>
                  <th>Anwesend</th>
                  <th>Bewertung</th>
                </tr>
              </thead>
              <tbody>
                {stats.course_types.map((ct) => (
                  <tr key={ct.name}>
                    <td>{ct.name}</td>
                    <td>{ct.courses}</td>
                    <td>{(ct.booked || 0).toLocaleString("de-DE")}</td>
                    <td>{ct.booked ? percent((ct.attended || 0) / ct.booked) : "–"}</td>
                    <td>{ct.avg_rating ? `★ ${ct.avg_rating.toLocaleString("de-DE")}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>Auslastung pro Studio</h2>
          <div className="table-wrap">
            <table className="st-table">
              <thead>
                <tr>
                  <th>Studio</th>
                  <th>Kurse</th>
                  <th>Gebucht</th>
                  <th>Auslastung</th>
                </tr>
              </thead>
              <tbody>
                {occupancy.map((s) => (
                  <tr key={s.id}>
                    <td>{shortStudioName(s.name)}</td>
                    <td>{s.courses}</td>
                    <td>{s.booked.toLocaleString("de-DE")}</td>
                    <td className="st-meter-cell">
                      <span className="st-meter">
                        <span style={{ width: `${s.rate * 100}%` }} />
                      </span>
                      {percent(s.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>Bestbewertete Trainer</h2>
          <p className="muted">Mindestens 3 Bewertungen.</p>
          <table className="st-table st-rank">
            <tbody>
              {stats.top_trainers.map((t, i) => (
                <tr key={t.name}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    {t.name}
                    <small className="block muted">{shortStudioName(t.studio_name)}</small>
                  </td>
                  <td>★ {t.avg_rating.toLocaleString("de-DE")}</td>
                  <td className="muted">{t.ratings} Bew.</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

const TABS = [
  ["finanzen", "Finanzen"],
  ["mitglieder", "Mitglieder"],
  ["kurse", "Kurse"],
];

/** Admin statistics in three tabs; all figures come from the local database. */
export default function StatsDashboard({ showError, setPage }) {
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState("finanzen");

  useEffect(() => {
    api.stats().then(setStats).catch((err) => showError(err.message));
  }, [showError]);

  return (
    <section className="st-page">
      <div className="st-tabs" role="tablist" aria-label="Bereich">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {!stats ? (
        <p className="muted">Zahlen werden geladen.</p>
      ) : tab === "finanzen" ? (
        <FinanceTab stats={stats} setPage={setPage} />
      ) : tab === "mitglieder" ? (
        <MembersTab stats={stats} />
      ) : (
        <CoursesTab stats={stats} />
      )}
    </section>
  );
}
