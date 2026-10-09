import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "./api.js";
import { formatDateLong, formatDateShort, shortStudioName, todayIso } from "./format.js";

const PLANS = { basic: "Basic", plus: "Plus", premium: "Premium", young: "Young" };
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

const memberNo = (id) => `FA-${String(id).padStart(6, "0")}`;
const monthLabel = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");

function MemberDetail({ id, data, showError, onClose, onSaved }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .adminMember(id)
      .then((res) => {
        setD(res);
        setForm({ membership_type: res.member.membership_type, home_studio_id: res.member.home_studio_id });
      })
      .catch((e) => showError(e.message));
  }, [id, showError]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    try {
      await api.adminUpdateMember(id, { ...form, home_studio_id: Number(form.home_studio_id) });
      setSaved(true);
      onSaved();
    } catch (e) {
      showError(e.message);
    }
  }

  const m = d?.member;
  const changed = m && (form.membership_type !== m.membership_type || Number(form.home_studio_id) !== m.home_studio_id);
  const today = todayIso();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal admin-member" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {!m ? (
          <p className="muted">Wird geladen.</p>
        ) : (
          <>
            <div className="admin-member-head">
              <div>
                <h2>{m.name}</h2>
                <span className="muted">
                  {memberNo(m.id)}, Mitglied seit {monthLabel(m.member_since)}
                </span>
              </div>
              <button className="secondary" onClick={onClose}>
                Schließen
              </button>
            </div>

            <dl className="admin-member-facts">
              <div>
                <dt>E-Mail</dt>
                <dd>{m.email}</dd>
              </div>
              <div>
                <dt>Telefon</dt>
                <dd>{m.phone || "nicht angegeben"}</dd>
              </div>
              <div>
                <dt>Geburtsdatum</dt>
                <dd>{m.birth_date ? formatDateLong(m.birth_date) : "nicht angegeben"}</dd>
              </div>
              <div>
                <dt>Anwesenheit</dt>
                <dd>
                  {d.attendance.past
                    ? `${d.attendance.attended} von ${d.attendance.past} gebuchten Kursen besucht`
                    : "noch keine vergangenen Kurse"}
                </dd>
              </div>
              <div>
                <dt>Bewertungen</dt>
                <dd>{d.rating.count ? `★ ${String(d.rating.avg).replace(".", ",")} (${d.rating.count})` : "keine"}</dd>
              </div>
              <div>
                <dt>Pausen</dt>
                <dd>
                  {d.pauses.length
                    ? d.pauses.map((p) => `${monthLabel(p.start_month)} (${p.months} Mon.)`).join(", ")
                    : "keine"}
                </dd>
              </div>
            </dl>

            <div className="admin-member-edit">
              <label>
                Tarif
                <select value={form.membership_type} onChange={(e) => setForm({ ...form, membership_type: e.target.value })}>
                  {Object.entries(PLANS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Heimstudio
                <select value={form.home_studio_id} onChange={(e) => setForm({ ...form, home_studio_id: e.target.value })}>
                  {(data.studios || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {shortStudioName(s.name)}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={!changed} onClick={save}>
                Sofort ändern
              </button>
              {saved && !changed && (
                <span className="saved-note" role="status">
                  Gespeichert, das Mitglied wurde benachrichtigt.
                </span>
              )}
            </div>
            {m.pending_membership_type && (
              <p className="muted">
                Vom Mitglied beantragt: Wechsel zu {PLANS[m.pending_membership_type]} ab {formatDateLong(m.pending_from)}.
              </p>
            )}

            <h3>Letzte Buchungen</h3>
            {d.bookings.length ? (
              <ul className="admin-member-bookings">
                {d.bookings.map((b) => (
                  <li key={b.id}>
                    <span>
                      {formatDateShort(b.date)} {b.start_time}
                    </span>
                    <span>
                      {b.course_type_name}, {shortStudioName(b.studio_name)}
                    </span>
                    <span className={`badge ${b.status === "cancelled" ? "" : b.attended ? "green" : b.date < today ? "red" : "orange"}`}>
                      {b.status === "cancelled"
                        ? "storniert"
                        : b.status === "waiting"
                          ? "Warteliste"
                          : b.attended
                            ? "besucht"
                            : b.date < today
                              ? "nicht erschienen"
                              : "gebucht"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Noch keine Buchungen.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Admin member directory with search, filters and a detail view. */
export default function AdminMembers({ data, showError }) {
  const [filters, setFilters] = useState({ q: "", studio_id: "", plan: "" });
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ total: 0, members: [] });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [reload, setReload] = useState(0);

  // Typing waits briefly before searching, so a query is not sent for every letter.
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => ({ ...f, q: query })), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api
      .adminMembers(params)
      .then(setResult)
      .catch((e) => showError(e.message))
      .finally(() => setLoading(false));
  }, [filters, reload, showError]);

  async function more() {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    const res = await api.adminMembers({ ...params, offset: result.members.length });
    setResult((r) => ({ ...r, members: [...r.members, ...res.members] }));
  }

  return (
    <section className="admin-members">
      <div className="admin-filters">
        <label className="admin-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, E-Mail oder FA-Nummer"
            aria-label="Mitglieder suchen"
          />
        </label>
        <select value={filters.studio_id} onChange={(e) => setFilters({ ...filters, studio_id: e.target.value })} aria-label="Studio">
          <option value="">Alle Studios</option>
          {(data.studios || []).map((s) => (
            <option key={s.id} value={s.id}>
              {shortStudioName(s.name)}
            </option>
          ))}
        </select>
        <select value={filters.plan} onChange={(e) => setFilters({ ...filters, plan: e.target.value })} aria-label="Tarif">
          <option value="">Alle Tarife</option>
          {Object.entries(PLANS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="muted">{loading ? "Suche…" : `${result.total.toLocaleString("de-DE")} Mitglieder`}</span>
      </div>

      <div className="panel admin-table-panel">
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Name</th>
                <th>Studio</th>
                <th>Tarif</th>
                <th>Mitglied seit</th>
                <th>Kommende Kurse</th>
              </tr>
            </thead>
            <tbody>
              {result.members.map((m) => (
                <tr key={m.id} onClick={() => setOpenId(m.id)} className="admin-row">
                  <td className="nowrap muted">{memberNo(m.id)}</td>
                  <td>
                    <button className="admin-row-link" onClick={() => setOpenId(m.id)}>
                      {m.name}
                    </button>
                    <small className="block muted">{m.email}</small>
                  </td>
                  <td>{shortStudioName(m.studio_name || "")}</td>
                  <td>
                    {PLANS[m.membership_type]}
                    {m.paused && <span className="badge orange admin-inline-badge">pausiert</span>}
                    {m.pending_membership_type && (
                      <small className="block muted">wechselt zu {PLANS[m.pending_membership_type]}</small>
                    )}
                  </td>
                  <td className="nowrap">{monthLabel(m.member_since)}</td>
                  <td>{m.upcoming}</td>
                </tr>
              ))}
              {!loading && !result.members.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    Keine Mitglieder gefunden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {result.members.length < result.total && (
          <button className="secondary admin-more" onClick={more}>
            Weitere laden ({result.members.length} von {result.total.toLocaleString("de-DE")})
          </button>
        )}
      </div>

      {openId && (
        <MemberDetail
          id={openId}
          data={data}
          showError={showError}
          onClose={() => setOpenId(null)}
          onSaved={() => setReload((n) => n + 1)}
        />
      )}
    </section>
  );
}
