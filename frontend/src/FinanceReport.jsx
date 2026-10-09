import { useCallback, useEffect, useState } from "react";
import { Printer, Trash2 } from "lucide-react";
import { api } from "./api.js";
import { formatDateLong, formatDateShort, shortStudioName, toIsoDate, todayIso } from "./format.js";

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// Company details are samples: Fit & Aktiv is a portfolio project, not a registered company.
const COMPANY = {
  name: "Fit & Aktiv GmbH",
  street: "Musterstraße 1",
  city: "47798 Krefeld",
  register: "Amtsgericht Krefeld, HRB 00000",
  management: "Geschäftsführung: Max Mustermann",
  taxNo: "Steuernummer: 117/0000/0000",
  vatId: "USt-IdNr.: DE000000000",
  bank: "IBAN: DE00 0000 0000 0000 0000 00",
};

const eur = (v) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (v) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = (v) => `${(v * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
const monthName = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function lastDay(iso) {
  return toIsoDate(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0));
}

function recentMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => toIsoDate(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7));
}

function ExpensePanel({ r, data, onChange, showError }) {
  const inMonth = todayIso().startsWith(r.month.slice(0, 7)) ? todayIso() : lastDay(r.month);
  const empty = { date: inMonth, studio_id: "", category: "wartung", description: "", amount_net: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addExpense({ ...form, studio_id: form.studio_id ? Number(form.studio_id) : null, amount_net: Number(form.amount_net) });
      setForm({ ...empty, category: form.category, studio_id: form.studio_id });
      onChange();
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(x) {
    if (!confirm(`„${x.description}“ über ${eur(x.amount_net)} € löschen?`)) return;
    try {
      await api.deleteExpense(x.id);
      onChange();
    } catch (err) {
      showError(err.message);
    }
  }

  return (
    <div className="fin-panel">
      <h2>Ausgabe erfassen</h2>
      <form className="fin-form" onSubmit={add}>
        <label>
          Datum
          <input type="date" required min={r.month} max={lastDay(r.month)} value={form.date} onChange={set("date")} />
        </label>
        <label>
          Betrag netto (€)
          <input type="number" required min="0.01" step="0.01" value={form.amount_net} onChange={set("amount_net")} placeholder="450,00" />
        </label>
        <label className="fin-wide">
          Kategorie
          <select value={form.category} onChange={set("category")}>
            {Object.entries(r.categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-wide">
          Studio
          <select value={form.studio_id} onChange={set("studio_id")}>
            <option value="">Zentrale Verwaltung</option>
            {(data.studios || []).map((s) => (
              <option key={s.id} value={s.id}>
                {shortStudioName(s.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="fin-wide">
          Beschreibung
          <input required maxLength={120} value={form.description} onChange={set("description")} placeholder="Laufband: Motor getauscht" />
        </label>
        <button type="submit" disabled={busy} className="fin-wide">
          Ausgabe buchen
        </button>
      </form>

      <h2>
        Ausgaben {SHORT[Number(r.month.slice(5, 7)) - 1]} <span className="muted">({r.expenses.length})</span>
      </h2>
      <ul className="fin-expenses">
        {r.expenses.map((x) => (
          <li key={x.id}>
            <div>
              <strong>{x.description}</strong>
              <small className="muted">
                {formatDateShort(x.date)}, {r.categories[x.category]}, {x.studio_name ? shortStudioName(x.studio_name) : "Zentrale"}
              </small>
            </div>
            <span className="fin-amount">{eur(x.amount_net)} €</span>
            <button className="icon-button ghost" onClick={() => remove(x)} aria-label={`${x.description} löschen`}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BwaDocument({ r }) {
  const L = Object.fromEntries(r.lines.map((l) => [l.key, l]));
  const ytdLabel = `Jan bis ${SHORT[Number(r.month.slice(5, 7)) - 1]} ${r.month.slice(0, 4)}`;
  const studioTotal = r.studios.reduce(
    (acc, s) => ({
      revenue: acc.revenue + s.revenue,
      personnel: acc.personnel + s.personnel,
      rooms: acc.rooms + s.rooms,
      other: acc.other + s.other,
      result: acc.result + s.result,
    }),
    { revenue: 0, personnel: 0, rooms: 0, other: 0, result: 0 },
  );

  return (
    <article className="finance-doc" aria-label={`BWA ${monthName(r.month)}`}>
      <header className="fd-head">
        <div className="fd-company">
          <strong>{COMPANY.name}</strong>
          <span>{COMPANY.street}</span>
          <span>{COMPANY.city}</span>
        </div>
        <dl className="fd-meta">
          <div>
            <dt>Dokument</dt>
            <dd>BWA Kurzbericht</dd>
          </div>
          <div>
            <dt>Belegnummer</dt>
            <dd>{r.document_no}</dd>
          </div>
          <div>
            <dt>Zeitraum</dt>
            <dd>
              {formatDateLong(r.month)} bis {formatDateLong(lastDay(r.month))}
            </dd>
          </div>
          <div>
            <dt>Stand</dt>
            <dd>{formatDateLong(r.created_at.slice(0, 10))}</dd>
          </div>
          <div>
            <dt>Erstellt von</dt>
            <dd>{r.created_by}, Studioleitung</dd>
          </div>
        </dl>
      </header>

      <h1 className="fd-title">Betriebswirtschaftliche Auswertung {monthName(r.month)}</h1>
      <p className="fd-lead">
        Vorläufige Auswertung für {r.studios.length} Studios und die zentrale Verwaltung. Alle Beträge in Euro, netto.
      </p>

      <div className="fd-keys">
        <div>
          <span>Gesamtleistung</span>
          <strong>{eur0(L.gesamtleistung.month)}</strong>
        </div>
        <div>
          <span>Gesamtkosten</span>
          <strong>{eur0(L.costs.month)}</strong>
        </div>
        <div>
          <span>Betriebsergebnis</span>
          <strong className={L.result.month < 0 ? "fd-neg" : ""}>{eur0(L.result.month)}</strong>
        </div>
        <div>
          <span>Umsatzrendite</span>
          <strong>{pct(L.result.month_pct)} %</strong>
        </div>
      </div>

      <h2 className="fd-section">1. Erfolgsrechnung</h2>
      <table className="fd-table fd-bwa">
        <thead>
          <tr>
            <th>Bezeichnung</th>
            <th>{monthName(r.month)}</th>
            <th>% GL</th>
            <th>{ytdLabel}</th>
            <th>% GL</th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.key} className={`fd-${l.kind}`}>
              <td>{l.label}</td>
              <td>{eur(l.month)}</td>
              <td>{pct(l.month_pct)}</td>
              <td>{eur(l.ytd)}</td>
              <td>{pct(l.ytd_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="fd-section">2. Ergebnis nach Studio (Kostenstellen)</h2>
      <table className="fd-table fd-compact">
        <thead>
          <tr>
            <th>Kst.</th>
            <th className="fd-text">Studio</th>
            <th>Erlöse</th>
            <th>Personal</th>
            <th>Raum</th>
            <th>Sonstige</th>
            <th>Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          {r.studios.map((s, i) => (
            <tr key={s.name}>
              <td>{101 + i}</td>
              <td className="fd-text">{shortStudioName(s.name)}</td>
              <td>{eur(s.revenue)}</td>
              <td>{eur(s.personnel)}</td>
              <td>{eur(s.rooms)}</td>
              <td>{eur(s.other)}</td>
              <td className={s.result < 0 ? "fd-neg" : ""}>{eur(s.result)}</td>
            </tr>
          ))}
          <tr>
            <td>900</td>
            <td className="fd-text">Zentrale Verwaltung</td>
            <td>{eur(0)}</td>
            <td>{eur(r.central.personnel)}</td>
            <td>{eur(0)}</td>
            <td>{eur(r.central.other)}</td>
            <td className="fd-neg">{eur(-(r.central.personnel + r.central.other))}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="fd-total">
            <td />
            <td className="fd-text">Summe</td>
            <td>{eur(studioTotal.revenue)}</td>
            <td>{eur(studioTotal.personnel + r.central.personnel)}</td>
            <td>{eur(studioTotal.rooms)}</td>
            <td>{eur(studioTotal.other + r.central.other)}</td>
            <td>{eur(studioTotal.result - r.central.personnel - r.central.other)}</td>
          </tr>
        </tfoot>
      </table>

      <h2 className="fd-section">3. Umsatzsteuer auf Mitgliedsbeiträge</h2>
      <table className="fd-table fd-summary">
        <tbody>
          <tr>
            <th>Beiträge brutto ({r.members.toLocaleString("de-DE")} zahlende Mitglieder)</th>
            <td>{eur(r.revenue_gross)}</td>
          </tr>
          <tr>
            <th>darin Umsatzsteuer {Math.round(r.vat_rate * 100)} %</th>
            <td>{eur(r.vat)}</td>
          </tr>
          <tr className="fd-total">
            <th>Umsatzerlöse netto</th>
            <td>{eur(L.revenue.month)}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="fd-section">4. Hinweise</h2>
      <ol className="fd-notes">
        <li>
          Vorläufige BWA. Kosten sind Nettobeträge; Vorsteuer wird gesondert in der Umsatzsteuer-Voranmeldung erfasst.
          Mitgliedsbeiträge enthalten {Math.round(r.vat_rate * 100)} % Umsatzsteuer (§ 12 Abs. 1 UStG).
        </li>
        <li>
          Personalkosten: Bruttogehälter laut Personalstamm zuzüglich Arbeitgeberanteil zur Sozialversicherung, pauschal{" "}
          {Math.round(r.social_rate * 100)} %. Die Studioleitung ist der Kostenstelle 900 zugeordnet.
        </li>
        <li>Miete und Energie sind monatliche Fixkosten je Studio; übrige Kosten laut erfassten Belegen.</li>
        <li>
          Interne Auswertung aus dem Kursverwaltungssystem. Keine Rechnung im Sinne des § 14 UStG; ersetzt weder
          Finanzbuchhaltung noch Jahresabschluss.
        </li>
      </ol>

      <div className="fd-signatures">
        <div>
          <span className="fd-line" />
          <small>Ort, Datum</small>
        </div>
        <div>
          <span className="fd-line" />
          <small>Studioleitung</small>
        </div>
        <div>
          <span className="fd-line" />
          <small>Finanzbuchhaltung (geprüft)</small>
        </div>
      </div>

      <footer className="fd-footer">
        <div>
          <span>{COMPANY.name}</span>
          <span>
            {COMPANY.street}, {COMPANY.city}
          </span>
        </div>
        <div>
          <span>{COMPANY.register}</span>
          <span>{COMPANY.management}</span>
        </div>
        <div>
          <span>{COMPANY.taxNo}</span>
          <span>{COMPANY.vatId}</span>
        </div>
        <div>
          <span>{COMPANY.bank}</span>
          <span>Musterangaben (Demo)</span>
        </div>
      </footer>
    </article>
  );
}

/** BWA (monthly business report) with expense entry; printed to PDF by the browser. */
export default function FinanceReport({ data, showError }) {
  const months = recentMonths(12);
  const [month, setMonth] = useState(months[0]);
  const [r, setR] = useState(null);

  const load = useCallback(() => {
    api.financeReport(month).then(setR).catch((e) => showError(e.message));
  }, [month, showError]);

  useEffect(() => {
    setR(null);
    load();
  }, [load]);

  return (
    <section className="fin-page">
      <div className="fin-doc-col">{r ? <BwaDocument r={r} /> : <p className="muted">Bericht wird erstellt.</p>}</div>

      <aside className="fin-side">
        <div className="fin-panel">
          <label>
            Berichtsmonat
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => window.print()} disabled={!r} className="fin-print">
            <Printer size={16} aria-hidden="true" /> Als PDF speichern
          </button>
          <p className="muted fin-hint">Im Druckdialog „Als PDF speichern“ wählen. Gedruckt wird nur der Bericht.</p>
        </div>
        {r && <ExpensePanel key={r.month} r={r} data={data} onChange={load} showError={showError} />}
      </aside>
    </section>
  );
}
