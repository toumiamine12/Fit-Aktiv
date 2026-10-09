import { useEffect, useMemo, useRef, useState } from "react";
import { api, getStoredAuth, setStoredAuth } from "./api.js";
import {
  CourseStatusBadge,
  StatusBadge,
  courseRowClass,
  hasAbsentTrainer,
  isAdmin,
  isMember,
  trainerCell,
} from "./courses.jsx";
import {
  addDays,
  formatDateLong,
  mondayOf,
  shortStudioName,
  toIsoDate,
  toLocalDate,
  todayIso,
} from "./format.js";
import Home, { scrollToSection } from "./Home.jsx";
import Logo from "./Logo.jsx";

import { MemberDashboard, MemberNotices, MemberProfile, MyCourses } from "./MemberArea.jsx";
import MemberTraining from "./MemberTraining.jsx";
import HomeWorkouts from "./HomeWorkouts.jsx";
import AbsenceForm from "./Absence.jsx";
import AdminMembers from "./AdminMembers.jsx";
import AdminOverview from "./AdminOverview.jsx";
import AdminPortal from "./AdminPortal.jsx";
import AdminTrials from "./AdminTrials.jsx";
import FinanceReport from "./FinanceReport.jsx";
import AvailabilityEditor from "./Availability.jsx";
import Attendance from "./Attendance.jsx";
import EmailOutbox from "./EmailOutbox.jsx";
import LeaveRequests from "./LeaveRequests.jsx";
import StatsDashboard from "./StatsDashboard.jsx";
import StaffCourseDialog from "./CourseDialog.jsx";
import StaffOverview from "./StaffOverview.jsx";
import StudioMap from "./StudioMap.jsx";
import TrainerAgenda from "./TrainerAgenda.jsx";
import WeekPlan from "./WeekPlan.jsx";

const emptyData = {
  stats: {},
  studios: [],
  employees: [],
  courses: [],
  rooms: [],
  course_types: [],
  notifications: [],
  weekly_counts: [],
  my_bookings: [],
  me: null,
};
const staffTabs = [
  "Dashboard",
  "Kurse",
  "Zeiten",
  "Check-in",
  "Mitarbeiter",
  "Studios",
  "Statistik",
  "Benachrichtigungen",
  "Profil",
  "Login",
];
const memberTabs = ["Dashboard", "Meine Kurse", "Mein Training", "Zuhause", "Benachrichtigungen", "Profil", "Login"];
const publicTabs = ["Home", "Login"];
// The admin works in a portal of its own (AdminPortal.jsx); these are its pages.
const adminTabs = [
  "Dashboard",
  "Kursplan",
  "Kurse",
  "Studios",
  "Mitglieder",
  "Mitarbeiter",
  "Zeiten",
  "Probetraining",
  "Statistik",
  "Finanzbericht",
  "Benachrichtigungen",
  "Profil",
];

function tabsForUser(user) {
  if (!user) return publicTabs;
  if (isMember(user)) return memberTabs;
  if (isAdmin(user)) return adminTabs;
  // Trainers have no staff management; their own data lives under "Profil".
  return staffTabs.filter((tab) => tab !== "Mitarbeiter" && tab !== "Statistik");
}

// Pages alternate gold and sapphire in menu order, starting with gold; home and profile stay gold.
function isSapphirePage(tab, user) {
  const pages = tabsForUser(user).filter((t) => !["Home", "Dashboard", "Profil", "Login"].includes(t));
  return pages.indexOf(tab) % 2 === 1;
}

function homeTab(user) {
  return user ? "Dashboard" : "Home";
}

const publicSections = [
  ["studios", "Studios"],
  ["kurse", "Kurse"],
  ["kursplan", "Kursplan"],
  ["probetraining", "Probetraining"],
];

function canOpenTab(tab, user) {
  return tabsForUser(user).includes(tab);
}

function ErrorBox({ error, onClose }) {
  if (!error) return null;
  return (
    <div className="error-box">
      <strong>Fehler:</strong> {error}
      <button onClick={onClose}>×</button>
    </div>
  );
}

function Header({
  activeTab,
  setActiveTab,
  goToSection,
  user,
  notifications,
  onLogout,
}) {
  const unreadCount = (notifications || []).filter((n) => !n.is_read).length;
  return (
    <header className="app-header">
      <div className="topbar">
        <button
          className="brand"
          onClick={() => setActiveTab(homeTab(user))}
          aria-label="Fit & Aktiv – zur Startseite"
        >
          <Logo />
        </button>
        <nav aria-label="Hauptnavigation">
          {user
            ? tabsForUser(user)
                .filter((tab) => tab !== "Login" && tab !== "Profil")
                .map((tab) => (
                  <button
                    key={tab}
                    className={`nav-link ${activeTab === tab ? "active" : ""}`}
                    aria-current={activeTab === tab ? "page" : undefined}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tabLabel(tab, user)}
                    {tab === "Benachrichtigungen" && unreadCount > 0 && (
                      <span className="count">{unreadCount}</span>
                    )}
                  </button>
                ))
            : publicSections.map(([id, label]) => (
                <button
                  key={id}
                  className="nav-link"
                  onClick={() => goToSection(id)}
                >
                  {label}
                </button>
              ))}
        </nav>
        <div className="account">
          {user ? (
            <AccountMenu
              user={user}
              active={activeTab === "Profil"}
              onProfile={() => setActiveTab("Profil")}
              onLogout={onLogout}
            />
          ) : (
            <button
              className="login-button"
              onClick={() => setActiveTab("Login")}
            >
              Anmelden
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/** Account button in the header; opens a small menu with the profile and logout. */
function AccountMenu({ user, active, onProfile, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const choose = (action) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="account-menu" ref={ref}>
      <button
        className={`account-button ${active || open ? "active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="account-name">
          {user.name}
          <small>{roleLabel(user)}</small>
        </span>
        <span className="account-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="account-dropdown" role="menu">
          <button role="menuitem" onClick={choose(onProfile)}>
            Mein Profil
          </button>
          <button role="menuitem" className="logout" onClick={choose(onLogout)}>
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}

function roleLabel(user) {
  if (isMember(user)) return "Mitglied";
  return user?.role === "admin" ? "Admin" : "Trainer";
}

const tabLabels = {
  Home: "Start",
  Dashboard: "Kursplan",
  "Meine Kurse": "Meine Kurse",
  "Mein Training": "Mein Training",
  Zuhause: "Zuhause trainieren",
  Profil: "Mein Profil",
  Kurse: "Kurse",
  Zeiten: "Zeiten",
  "Check-in": "Check-in",
  Mitarbeiter: "Mitarbeiter",
  Studios: "Studios",
  Statistik: "Statistik",
  Benachrichtigungen: "Nachrichten",
  Login: "Anmelden",
};

function tabLabel(tab, user) {
  if (isAdmin(user)) return tabLabels[tab];
  return { Zeiten: "Meine Zeiten" }[tab] || tabLabels[tab];
}

function initials(name = "") {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function LoginRequired({ setActiveTab }) {
  return (
    <section className="panel login-wall">
      <h2>Bitte zuerst anmelden</h2>
      <p>
        Der Kursplan ist öffentlich. Kurse, Mitarbeiter, Studios und
        Nachrichten sehen Sie nach der Anmeldung.
      </p>
      <button onClick={() => setActiveTab("Login")}>Zur Anmeldung</button>
    </section>
  );
}

function NoPermission({ setActiveTab }) {
  return (
    <section className="panel login-wall">
      <h2>Keine Berechtigung</h2>
      <p>Diese Funktion ist nur für Admins freigeschaltet.</p>
      <button onClick={() => setActiveTab("Dashboard")}>
        Zurück zum Kursplan
      </button>
    </section>
  );
}

function Dashboard({ data, user, refresh, showError, bare = false }) {
  const [openCourse, setOpenCourse] = useState(null);

  return (
    <section className="page-grid">
      {!bare && <div className="plan-hero">
        <div className="plan-hero-text">
          <h1>Kursplan</h1>
          <p>
            {isAdmin(user)
              ? "Alle Kurse aller Studios"
              : "Ihre Kurse und Schichten"}
          </p>
        </div>
      </div>}

      <WeekPlan
        data={data}
        user={user}
        showTable={false}
        onCourseClick={setOpenCourse}
      />
      {!bare && <StaffOverview data={data} user={user} onOpen={setOpenCourse} />}
      {openCourse && (
        <StaffCourseDialog
          course={openCourse}
          user={user}
          refresh={refresh}
          showError={showError}
          onClose={() => setOpenCourse(null)}
        />
      )}
    </section>
  );
}

function CourseForm({ data, onCreate }) {
  const [form, setForm] = useState({
    course_type_id: "",
    date: todayIso(),
    start_time: "10:00",
    duration_minutes: 60,
    room_id: "",
    trainer_id: "",
    special_event: false,
  });
  const selectedRoom = data.rooms?.find(
    (r) => String(r.id) === String(form.room_id),
  );
  const employeesForStudio = (data.employees || [])
    .filter(
      (e) =>
        !selectedRoom ||
        e.home_studio_id === selectedRoom.studio_id ||
        e.can_travel,
    )
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  const submit = async (e) => {
    e.preventDefault();
    await onCreate({
      ...form,
      trainer_id: form.trainer_id || null,
      course_type_id: Number(form.course_type_id),
      room_id: Number(form.room_id),
      duration_minutes: Number(form.duration_minutes),
    });
    setForm({ ...form, trainer_id: "" });
  };
  return (
    <form className="form-card" onSubmit={submit}>
      <h3>Neuen Kurs anlegen</h3>
      <label>
        Kurstyp
        <select
          required
          value={form.course_type_id}
          onChange={(e) => setForm({ ...form, course_type_id: e.target.value })}
        >
          <option value="">Bitte wählen</option>
          {data.course_types?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Datum{" "}
        <input
          type="date"
          required
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </label>
      <label>
        Start{" "}
        <input
          type="time"
          required
          value={form.start_time}
          onChange={(e) => setForm({ ...form, start_time: e.target.value })}
        />
      </label>
      <label>
        Dauer Minuten{" "}
        <input
          type="number"
          min="30"
          step="15"
          value={form.duration_minutes}
          onChange={(e) =>
            setForm({ ...form, duration_minutes: e.target.value })
          }
        />
      </label>
      <label>
        Raum / Studio
        <select
          required
          value={form.room_id}
          onChange={(e) =>
            setForm({ ...form, room_id: e.target.value, trainer_id: "" })
          }
        >
          <option value="">Bitte wählen</option>
          {data.rooms?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.studio_name})
            </option>
          ))}
        </select>
      </label>
      <label>
        Trainer optional
        <select
          value={form.trainer_id}
          onChange={(e) => setForm({ ...form, trainer_id: e.target.value })}
        >
          <option value="">ohne Trainer / Ersatz nötig</option>
          {employeesForStudio.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.qualifications})
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.special_event}
          onChange={(e) =>
            setForm({ ...form, special_event: e.target.checked })
          }
        />{" "}
        Sonderveranstaltung
      </label>
      <button type="submit">Kurs speichern</button>
    </form>
  );
}


function WeeklyCourseGenerator({ onGenerate }) {
  const [weekStart, setWeekStart] = useState(() =>
    toIsoDate(mondayOf(toLocalDate(todayIso()))),
  );
  const submit = async (e) => {
    e.preventDefault();
    await onGenerate(weekStart);
  };
  return (
    <form className="form-card generator-card" onSubmit={submit}>
      <h3>Zufällige Wochenkurse generieren</h3>
      <p>
        Erstellt automatisch Kurse von Montag bis Freitag in allen Studios.
        Bereits vorhandene Kurse im gleichen Raum und zur gleichen Uhrzeit werden
        übersprungen.
      </p>
      <label>
        Woche ab Montag
        <input
          type="date"
          value={weekStart}
          onChange={(e) =>
            setWeekStart(toIsoDate(mondayOf(toLocalDate(e.target.value))))
          }
        />
      </label>
      <button type="submit">Wochenkurse generieren</button>
    </form>
  );
}

function YearlyCourseGenerator({ onGenerate }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onGenerate(Number(year));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form-card generator-card" onSubmit={submit}>
      <h3>Zufällige Jahreskurse generieren</h3>
      <p>
        Wird beim Backend-Start automatisch für das aktuelle Jahr erstellt. Der
        Button kann den Plan zusätzlich manuell für ein anderes Jahr erzeugen.
        Vollzeit-Mitarbeiter bekommen maximal 20 Kurse pro Monat,
        Teilzeit-Mitarbeiter maximal 10 Kurse pro Monat.
      </p>
      <label>
        Jahr
        <input
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Jahreskurse werden generiert..." : "Jahreskurse generieren"}
      </button>
    </form>
  );
}

function Courses({ data, refresh, showError, user }) {
  const admin = isAdmin(user);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [replacement, setReplacement] = useState(null);
  const [selectedTrainer, setSelectedTrainer] = useState("");
  const [busyCourse, setBusyCourse] = useState(null);

  const courses = useMemo(() => {
    const q = query.toLowerCase();
    return (data.courses || [])
      .filter((c) => {
        const matchesQuery =
          !q ||
          `${c.course_type_name} ${c.studio_name} ${c.trainer_name || ""} ${c.absent_trainer_name || ""} ${c.date}`
            .toLowerCase()
            .includes(q);
        const matchesStatus =
          status === "all" ||
          c.status === status ||
          (status === "krank" && hasAbsentTrainer(c));
        const matchesOwn =
          admin ||
          !user ||
          String(c.trainer_id) === String(user.id) ||
          String(c.absent_trainer_id) === String(user.id);
        return matchesQuery && matchesStatus && matchesOwn;
      })
      .slice(0, 250);
  }, [data.courses, query, status, admin, user]);
  async function createCourse(payload) {
    try {
      await api.createCourse(payload);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }
  async function generateWeekCourses(weekStart) {
    try {
      const res = await api.generateWeekCourses(weekStart);
      await refresh();
      alert(
        `Wochenkurse generiert: ${res.generated.length} neu, ${res.skipped_existing} bereits vorhanden, ${res.skipped_no_trainer || 0} ohne Trainer.`,
      );
    } catch (e) {
      showError(e.message);
    }
  }
  async function generateYearCourses(year) {
    try {
      const res = await api.generateYearCourses(year);
      await refresh();
      const generatedCount = res.generated_count ?? res.generated?.length ?? 0;
      setQuery(String(res.year || year));
      const cleanedText = res.cleaned_unassigned ? `, ${res.cleaned_unassigned} alte Ersatz-Kurse entfernt` : "";
      alert(
        `Jahreskurse ${res.year || year} generiert: ${generatedCount} neu, ${res.skipped_existing} bereits vorhanden, ${res.skipped_no_trainer || 0} ohne Trainer${cleanedText}.`,
      );
    } catch (e) {
      showError(e.message);
    }
  }
  async function findReplacement(courseId) {
    try {
      setBusyCourse(courseId);
      const res = await api.getReplacements(courseId);
      setReplacement(res);
      setSelectedTrainer(res.candidates?.[0]?.id || "");
    } catch (e) {
      showError(e.message);
    } finally {
      setBusyCourse(null);
    }
  }
  async function assignReplacement() {
    if (!replacement || !selectedTrainer) return;
    try {
      await api.assignCourse(replacement.course.id, Number(selectedTrainer));
      setReplacement(null);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }
  async function cancelCourse(courseId) {
    try {
      await api.cancelCourse(courseId);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }
  async function deleteCourse(courseId) {
    if (!confirm("Kurs wirklich löschen?")) return;
    try {
      await api.deleteCourse(courseId);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }

  return (
    <section className={admin ? "two-col" : "page-grid"}>
      {admin && (
        <div>
          <CourseForm data={data} onCreate={createCourse} />
          <WeeklyCourseGenerator onGenerate={generateWeekCourses} />
          <YearlyCourseGenerator onGenerate={generateYearCourses} />
        </div>
      )}
      <div className="panel wide">
        <div className="panel-title">
          <div>
            <h2>Alle Kurse</h2>
            {!admin && user && (
              <small>
                Hier sehen Sie Ihre eigenen Kurse. Wenn Sie krankgemeldet sind,
                bleiben Ihre Schichten sichtbar und werden als krank markiert.
              </small>
            )}
            {!user && (
              <small>
                Ansicht nach Login. Kurs anlegen, löschen und Vertretung
                zuweisen ist nur für Admins möglich.
              </small>
            )}
          </div>
          <div className="filters">
            <input
              placeholder="Suche Kurs, Studio, Trainer..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">alle Status</option>
              <option value="active">aktiv</option>
              <option value="needs_replacement">Ersatz nötig</option>
              <option value="krank">krank</option>
              <option value="cancelled">ausgefallen</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Kurs</th>
                <th>Studio/Raum</th>
                <th>Trainer</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr
                  key={c.id}
                  className={courseRowClass(c, user)}
                >
                  <td className="nowrap">
                    {formatDateLong(c.date)}
                    <br />
                    <small>
                      {c.start_time} Uhr, {c.duration_minutes} min
                    </small>
                  </td>
                  <td>
                    {c.course_type_name}
                    <br />
                    <small>Quali: {c.required_qualification}</small>
                  </td>
                  <td>
                    {shortStudioName(c.studio_name)}
                    <br />
                    <small>{c.room_name}</small>
                  </td>
                  <td>{trainerCell(c, user)}</td>
                  <td>
                    <CourseStatusBadge course={c} user={user} />
                  </td>
                  <td className="actions">
                    {admin ? (
                      <>
                        <button
                          onClick={() => findReplacement(c.id)}
                          disabled={busyCourse === c.id}
                        >
                          {busyCourse === c.id ? "Suche..." : "Ersatz suchen"}
                        </button>
                        <button
                          className="secondary"
                          onClick={() => cancelCourse(c.id)}
                        >
                          Ausfallen
                        </button>
                        <button
                          className="danger"
                          onClick={() => deleteCourse(c.id)}
                        >
                          Löschen
                        </button>
                      </>
                    ) : (
                      <span className="muted">nur Ansicht</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {admin && replacement && (
        <div className="modal-backdrop" onClick={() => setReplacement(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Vertretung für {replacement.course.course_type_name} finden</h2>
            <p>
              <strong>{replacement.course.course_type_name}</strong> am{" "}
              {replacement.course.date} um {replacement.course.start_time} in{" "}
              {replacement.course.studio_name}.
            </p>
            {replacement.candidates.length === 0 ? (
              <div className="empty">
                Kein geeigneter Ersatztrainer gefunden. Der Kurs kann als
                ausgefallen markiert werden.
              </div>
            ) : (
              <>
                <label>
                  Geeigneten Ersatztrainer wählen
                  <select
                    value={selectedTrainer}
                    onChange={(e) => setSelectedTrainer(e.target.value)}
                  >
                    {replacement.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.same_studio ? "gleiches Studio" : "pendelt"}, Score {c.score})
                      </option>
                    ))}
                  </select>
                </label>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Qualifikationen</th>
                      <th>Modell</th>
                      <th>Info</th>
                    </tr>
                  </thead>
                  <tbody>
                    {replacement.candidates.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.qualifications}</td>
                        <td>{c.employment_model}</td>
                        <td>
                          {c.same_studio
                            ? "gleiches Studio"
                            : "Fahrtzeit geprüft"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <div className="modal-actions">
              {replacement.candidates.length > 0 && (
                <button onClick={assignReplacement}>
                  Ersatztrainer zuweisen
                </button>
              )}
              <button
                className="secondary"
                onClick={() => setReplacement(null)}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function EmployeeForm({ data, onCreate }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "trainer",
    qualifications: "Yoga,Pilates",
    employment_model: "Teilzeit",
    home_studio_id: "",
    can_travel: true,
  });
  const submit = async (e) => {
    e.preventDefault();
    await onCreate({ ...form, home_studio_id: Number(form.home_studio_id) });
    setForm({ ...form, name: "", email: "", password: "" });
  };
  return (
    <form className="form-card employee-form" onSubmit={submit}>
      <h3>Mitarbeiter anlegen</h3>
      <label>
        Name{" "}
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        E-Mail{" "}
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </label>
      <label>
        Passwort{" "}
        <input
          required
          type="password"
          minLength={8}
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </label>
      <label>
        Rolle
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="trainer">trainer</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <label>
        Qualifikationen{" "}
        <input
          value={form.qualifications}
          onChange={(e) => setForm({ ...form, qualifications: e.target.value })}
        />
      </label>
      <label>
        Beschäftigungsmodell
        <select
          value={form.employment_model}
          onChange={(e) =>
            setForm({ ...form, employment_model: e.target.value })
          }
        >
          <option value="Vollzeit">Vollzeit</option>
          <option value="Teilzeit">Teilzeit</option>
        </select>
      </label>
      <label>
        Heimstudio
        <select
          required
          value={form.home_studio_id}
          onChange={(e) => setForm({ ...form, home_studio_id: e.target.value })}
        >
          <option value="">Bitte wählen</option>
          {data.studios?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.can_travel}
          onChange={(e) => setForm({ ...form, can_travel: e.target.checked })}
        />{" "}
        kann zwischen Studios pendeln
      </label>
      <button type="submit">Mitarbeiter speichern</button>
    </form>
  );
}

/** Monthly gross salary, edited in place; saved when the field is left or Enter is pressed. */
function SalaryInput({ employee, refresh, showError }) {
  const [value, setValue] = useState(String(employee.monthly_salary ?? ""));
  const [state, setState] = useState("");

  async function save() {
    const amount = Number(value.replace(",", "."));
    if (value === "" || amount === employee.monthly_salary) return;
    try {
      await api.updateEmployee(employee.id, { monthly_salary: amount });
      setState("saved");
      await refresh();
    } catch (err) {
      setState("");
      showError(err.message);
    }
  }

  return (
    <label className="salary-input">
      <span className="sr-only">Monatsgehalt brutto von {employee.name}</span>
      <input
        type="number"
        min="0"
        step="10"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setState("");
        }}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <small className={state === "saved" ? "saved" : "muted"}>{state === "saved" ? "gespeichert" : "€ / Monat"}</small>
    </label>
  );
}

function Employees({ data, refresh, showError }) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const employees = useMemo(() => {
    const q = query.toLowerCase();
    return (data.employees || [])
      .filter(
        (e) =>
          !q ||
          `${e.name} ${e.email} ${e.home_studio_name} ${e.qualifications}`
            .toLowerCase()
            .includes(q),
      )
      .slice(0, 250);
  }, [data.employees, query]);

  async function createEmployee(payload) {
    try {
      await api.createEmployee(payload);
      await refresh();
      setAdding(false);
    } catch (e) {
      showError(e.message);
    }
  }
  async function markAvailable(id) {
    try {
      await api.markAvailable(id);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }
  async function deleteEmployee(id) {
    if (!confirm("Mitarbeiter wirklich löschen?")) return;
    try {
      await api.deleteEmployee(id);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }

  return (
    <section className="staff-page">
      {adding && <EmployeeForm data={data} onCreate={createEmployee} />}

      <div className="panel wide">
          <div className="panel-title">
            <h2>Alle Mitarbeiter</h2>
            <div className="panel-tools">
              <input
                placeholder="Suche Mitarbeiter..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className={adding ? "secondary" : ""} onClick={() => setAdding(!adding)}>
                {adding ? "Abbrechen" : "Neuer Mitarbeiter"}
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Studio</th>
                  <th>Qualifikationen</th>
                  <th>Modell</th>
                  <th>Gehalt brutto</th>
                  <th>Status</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr
                    key={e.id}
                    className={e.status === "unavailable" ? "attention" : ""}
                  >
                    <td>
                      {e.name}
                      <br />
                      <small className="block">{e.email}</small>
                      <small>{e.role === "admin" ? "Admin" : "Trainer"}</small>
                    </td>
                    <td>
                      {shortStudioName(e.home_studio_name)}
                      <br />
                      <small>
                        {e.can_travel ? "pendeln ja" : "kein Pendeln"}
                      </small>
                    </td>
                    <td>{(e.qualifications || "").split(",").join(", ")}</td>
                    <td>
                      {e.employment_model}
                      <br />
                      <small className="block contract">
                        max. {e.max_courses_per_week}/Woche
                      </small>
                    </td>
                    <td>
                      <SalaryInput employee={e} refresh={refresh} showError={showError} />
                    </td>
                    <td>
                      <StatusBadge status={e.status} />
                      {e.unavailable_reason && (
                        <small className="block">{e.unavailable_reason}</small>
                      )}
                    </td>
                    <td className="actions">
                      {e.status === "unavailable" && (
                        <button onClick={() => markAvailable(e.id)}>
                          wieder verfügbar
                        </button>
                      )}
                      <button
                        className="danger"
                        onClick={() => deleteEmployee(e.id)}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </section>
  );
}

function Studios({ data, refresh, showError, user }) {
  const [form, setForm] = useState({ name: "", address: "" });
  const [studioId, setStudioId] = useState(user?.home_studio_id || data.studios?.[0]?.id);
  const weekEnd = toIsoDate(addDays(new Date(), 6));
  const today = todayIso();

  async function submit(e) {
    e.preventDefault();
    try {
      await api.createStudio(form);
      setForm({ name: "", address: "" });
      await refresh();
    } catch (err) {
      showError(err.message);
    }
  }

  function details(studio) {
    const team = (data.employees || []).filter((e) => e.home_studio_id === studio.id);
    const rooms = (data.rooms || []).filter((r) => r.studio_id === studio.id);
    const courses = (data.courses || []).filter(
      (c) => c.studio_id === studio.id && c.status !== "cancelled" && c.date >= today && c.date <= weekEnd,
    );
    return (
      <dl className="studio-facts">
        <div>
          <dt>Team</dt>
          <dd>{team.length ? team.map((e) => e.name).join(", ") : "noch niemand"}</dd>
        </div>
        <div>
          <dt>Räume</dt>
          <dd>{rooms.map((r) => `${r.name} (${r.capacity} Plätze)`).join(", ") || "keine"}</dd>
        </div>
        <div>
          <dt>Nächste 7 Tage</dt>
          <dd>{courses.length} Kurse</dd>
        </div>
      </dl>
    );
  }

  return (
    <section className="studios-page">
      <StudioMap
        studios={data.studios || []}
        selectedId={studioId}
        onSelect={setStudioId}
        renderDetails={details}
        showList={false}
      />
      {isAdmin(user) && (
        <form className="form-card studio-form" onSubmit={submit}>
          <h3>Studio anlegen</h3>
          <label>
            Name{" "}
            <input
              required
              placeholder="Studio Kempen"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Adresse{" "}
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </label>
          <button type="submit">Studio speichern</button>
        </form>
      )}
    </section>
  );
}

function Notifications({ data, refresh, showError, user }) {
  async function read(id) {
    try {
      await api.markNotificationRead(id);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }
  async function readAll() {
    try {
      await api.markAllNotificationsRead();
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }
  const unread = (data.notifications || []).filter((n) => !n.is_read).length;
  return (
    <section className="panel wide">
      <div className="panel-title notifications-head">
        <span className="muted">{unread ? `${unread} ungelesen` : "Alles gelesen"}</span>
        <button className="secondary" onClick={readAll} disabled={!unread}>
          Alle als gelesen markieren
        </button>
      </div>
      <div className="notifications">
        {data.notifications?.map((n) => (
          <div key={n.id} className={`notification ${n.is_read ? "read" : ""}`}>
            <div>
              <strong>
                {isMember(user) ? "Fit & Aktiv" : n.recipient_name || "Admin / Planung"}
              </strong>
              <small>
                {formatDateLong(n.created_at.slice(0, 10))}, {n.created_at.slice(11, 16)} Uhr
              </small>
            </div>
            <p>{n.message}</p>
            {!n.is_read && (
              <button onClick={() => read(n.id)}>als gelesen markieren</button>
            )}
          </div>
        ))}
        {data.notifications?.length === 0 && (
          <div className="empty neutral">Keine Benachrichtigungen.</div>
        )}
      </div>
    </section>
  );
}

function MessagesPage(props) {
  return (
    <div className="messages-page">
      <Notifications {...props} />
      {isAdmin(props.user) && <EmailOutbox showError={props.showError} />}
    </div>
  );
}

const portalText = {
  member: {
    title: "Mitgliederbereich",
    text: "Buchen Sie Kursplätze, behalten Sie Ihre Termine im Blick und pflegen Sie Ihre Daten. Nach der Anmeldung sehen Sie direkt den Kursplan Ihres Studios.",
  },
  employee: {
    title: "Mitarbeiterbereich",
    text: "Kursplanung, Vertretungen, Krankmeldungen und Nachrichten für Trainerinnen, Trainer und die Studioleitung.",
  },
};

function Login({ user, data, setAuth, setActiveTab, showError, refresh }) {
  const [accountType, setAccountType] = useState(
    user && !isMember(user) ? "employee" : "member",
  );
  // ?reset=<token> comes from the password reset e-mail.
  const resetToken = new URLSearchParams(window.location.search).get("reset");
  const [mode, setMode] = useState(resetToken ? "reset" : "login");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registration, setRegistration] = useState({
    name: "",
    email: "",
    password: "",
    home_studio_id: "",
    phone: "",
    birth_date: "",
  });
  const [busy, setBusy] = useState(false);
  const registering = accountType === "member" && mode === "register";

  async function signIn(res) {
    const auth = { user: res.user, token: res.token };
    setStoredAuth(auth);
    setAuth(auth);
    setActiveTab("Dashboard");
    await refresh();
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "forgot") {
        await api.requestPasswordReset(email, accountType);
        setNotice("Falls ein Konto mit dieser E-Mail existiert, haben wir Ihnen einen Link geschickt.");
      } else if (mode === "reset") {
        await api.confirmPasswordReset(resetToken, password);
        window.history.replaceState(null, "", window.location.pathname);
        setPassword("");
        setMode("login");
        setNotice("Ihr Passwort wurde geändert. Sie können sich jetzt anmelden.");
      } else if (registering) {
        await signIn(
          await api.registerMember({
            ...registration,
            home_studio_id: Number(registration.home_studio_id),
          }),
        );
      } else {
        await signIn(await api.login(email, password, accountType));
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setStoredAuth(null);
    setAuth(null);
    setActiveTab("Home");
  }

  function chooseType(type) {
    setAccountType(type);
    setMode("login");
    setNotice("");
  }

  const formTitle = registering
    ? "Konto erstellen"
    : { login: "Anmelden", forgot: "Passwort vergessen", reset: "Neues Passwort festlegen" }[mode];
  const submitLabel = registering
    ? "Konto erstellen"
    : { login: "Anmelden", forgot: "Link senden", reset: "Passwort speichern" }[mode];

  const reg = (key) => (e) =>
    setRegistration({ ...registration, [key]: e.target.value });

  return (
    <section className="login-layout">
      <div className={`login-intro ${accountType}`}>
        <Logo tone="light" />
        <h1>{portalText[accountType].title}</h1>
        <p>{portalText[accountType].text}</p>
      </div>
      <div className="login-card">
        {user && (
          <div className="success">
            <span>
              Angemeldet als <strong>{user.name}</strong> ({roleLabel(user)})
            </span>
            <button className="secondary" onClick={logout}>
              Abmelden
            </button>
          </div>
        )}
        <div className="account-switch" role="tablist" aria-label="Kontoart">
          <button
            role="tab"
            aria-selected={accountType === "member"}
            className={accountType === "member" ? "active" : ""}
            onClick={() => chooseType("member")}
          >
            Mitglied
          </button>
          <button
            role="tab"
            aria-selected={accountType === "employee"}
            className={accountType === "employee" ? "active" : ""}
            onClick={() => chooseType("employee")}
          >
            Mitarbeiter
          </button>
        </div>
        <form className="login-form" onSubmit={submit}>
          <h2>{formTitle}</h2>
          {notice && (
            <p className="saved-note" role="status">
              {notice}
            </p>
          )}
          {registering ? (
            <>
              <label>
                Name
                <input required autoComplete="name" value={registration.name} onChange={reg("name")} />
              </label>
              <label>
                E-Mail
                <input required type="email" autoComplete="email" value={registration.email} onChange={reg("email")} />
              </label>
              <label>
                <span>Passwort <small>(mindestens 8 Zeichen)</small></span>
                <input required type="password" minLength={8} autoComplete="new-password" value={registration.password} onChange={reg("password")} />
              </label>
              <label>
                Ihr Studio
                <select required value={registration.home_studio_id} onChange={reg("home_studio_id")}>
                  <option value="">Bitte wählen</option>
                  {(data.studios || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {shortStudioName(s.name)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  <span>Telefon <small>(optional)</small></span>
                  <input type="tel" autoComplete="tel" value={registration.phone} onChange={reg("phone")} />
                </label>
                <label>
                  <span>Geburtsdatum <small>(optional)</small></span>
                  <input type="date" value={registration.birth_date} onChange={reg("birth_date")} />
                </label>
              </div>
            </>
          ) : (
            <>
              {mode !== "reset" && (
                <label>
                  E-Mail
                  <input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              )}
              {mode === "login" && (
                <label>
                  Passwort
                  <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
              {mode === "reset" && (
                <label>
                  <span>Neues Passwort <small>(mindestens 8 Zeichen)</small></span>
                  <input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
            </>
          )}
          <button type="submit" disabled={busy}>
            {submitLabel}
          </button>
          {mode === "login" && (
            <p className="form-switch">
              <button type="button" className="text-link" onClick={() => { setMode("forgot"); setNotice(""); }}>
                Passwort vergessen?
              </button>
            </p>
          )}
          {(mode === "forgot" || mode === "reset") && (
            <p className="form-switch">
              <button type="button" className="text-link" onClick={() => { setMode("login"); setNotice(""); }}>
                Zurück zur Anmeldung
              </button>
            </p>
          )}
          {accountType === "member" && (mode === "login" || mode === "register") && (
            <p className="form-switch">
              {registering ? "Schon Mitglied?" : "Noch kein Konto?"}{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => setMode(registering ? "login" : "register")}
              >
                {registering ? "Hier anmelden" : "Jetzt registrieren"}
              </button>
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => getStoredAuth());
  const user = auth?.user || null;
  const userKey = user ? `${user.role}:${user.id}` : "";
  const [activeTab, setActiveTab] = useState(() =>
    new URLSearchParams(window.location.search).has("reset") ? "Login" : homeTab(auth?.user),
  );
  const [data, setData] = useState(emptyData);
  const [error, setError] = useState("");

  async function refresh(silent = false) {
    try {
      const res = await api.getData();
      setData(res);
    } catch (e) {
      if ((e.message || "").includes("Bitte zuerst einloggen")) {
        setStoredAuth(null);
        setAuth(null);
        setActiveTab("Login");
      }
      if (!silent) setError(e.message);
    }
  }

  // Polls the tiny /api/revision every 2 s and only downloads the full data when the database changed.
  const revision = useRef("");
  async function sync(silent) {
    const rev = await api.getRevision().then((r) => JSON.stringify(r.revision)).catch(() => "");
    if (rev && rev === revision.current) return;
    revision.current = rev;
    await refresh(silent);
  }

  useEffect(() => {
    if (!canOpenTab(activeTab, user)) setActiveTab(homeTab(user));
    revision.current = "";
    sync(false);
    const id = setInterval(() => sync(true), 2000);
    return () => clearInterval(id);
  }, [userKey]);

  useEffect(() => {
    if (!canOpenTab(activeTab, user)) setActiveTab(homeTab(user));
  }, [activeTab, userKey]);

  // A new page starts clean: no scroll offset and no error left over from the previous page.
  useEffect(() => {
    window.scrollTo(0, 0);
    setError("");
  }, [activeTab]);

  function logout() {
    setStoredAuth(null);
    setAuth(null);
    setActiveTab("Home");
  }

  function goToSection(id) {
    if (activeTab === "Home") {
      scrollToSection(id);
    } else {
      setActiveTab("Home");
      setTimeout(() => scrollToSection(id), 50);
    }
  }

  function updateUser(changes) {
    const next = { ...auth, user: { ...auth.user, ...changes } };
    setStoredAuth(next);
    setAuth(next);
  }

  const props = {
    data,
    refresh: () => refresh(false),
    showError: setError,
    user,
  };
  const blocked = !canOpenTab(activeTab, user);
  const member = isMember(user);

  if (isAdmin(user)) {
    const pages = {
      Dashboard: () => <AdminOverview user={user} setPage={setActiveTab} showError={setError} />,
      Kursplan: () => <Dashboard {...props} bare />,
      Kurse: () => <Courses {...props} />,
      Studios: () => <Studios {...props} />,
      Mitglieder: () => <AdminMembers data={data} showError={setError} />,
      Mitarbeiter: () => <Employees {...props} />,
      Zeiten: () => (
        <section className="times-page">
          <AvailabilityEditor {...props} />
          <AbsenceForm {...props} />
          <LeaveRequests {...props} />
        </section>
      ),
      Probetraining: () => <AdminTrials showError={setError} />,
      Statistik: () => <StatsDashboard showError={setError} setPage={setActiveTab} />,
      Finanzbericht: () => <FinanceReport data={data} showError={setError} />,
      Benachrichtigungen: () => <MessagesPage {...props} />,
      Profil: () => <MemberProfile {...props} onUserUpdate={updateUser} />,
    };
    // Called as a plain function, not mounted as <Page />: a component created during render would
    // remount on every data refresh and lose its state (search input, open dialog).
    const renderPage = pages[activeTab] || pages.Dashboard;
    return (
      <AdminPortal
        user={user}
        page={pages[activeTab] ? activeTab : "Dashboard"}
        setPage={setActiveTab}
        unread={(data.notifications || []).filter((n) => !n.is_read).length}
        onLogout={logout}
        sapphire={isSapphirePage(activeTab, user)}
        error={<ErrorBox error={error} onClose={() => setError("")} />}
      >
        {renderPage()}
      </AdminPortal>
    );
  }
  const showTitle =
    !blocked && !["Home", "Dashboard", "Login"].includes(activeTab);

  return (
    <div className="app">
      <Header
        onLogout={logout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        goToSection={goToSection}
        user={user}
        notifications={data.notifications}
      />
      <main
        className={activeTab === "Home" ? "main-home" : ""}
        data-accent={isSapphirePage(activeTab, user) ? "sapphire" : undefined}
      >
        {showTitle && (
          <div className="page-head">
            <h1>
              {isAdmin(user) || !["Kurse", "Zeiten"].includes(activeTab)
                ? pageTitles[activeTab]
                : { Kurse: "Ihre Kurse", Zeiten: "Meine Zeiten" }[activeTab]}
            </h1>
          </div>
        )}
        <ErrorBox error={error} onClose={() => setError("")} />
        {member && activeTab !== "Benachrichtigungen" && <MemberNotices {...props} />}
        {blocked && !user && <LoginRequired setActiveTab={setActiveTab} />}
        {blocked && user && <NoPermission setActiveTab={setActiveTab} />}
        {!blocked && activeTab === "Home" && (
          <Home
            data={data}
            showError={setError}
            goToLogin={() => setActiveTab("Login")}
          />
        )}
        {!blocked && activeTab === "Dashboard" && member && (
          <MemberDashboard {...props} setActiveTab={setActiveTab} />
        )}
        {!blocked && activeTab === "Dashboard" && !member && (
          <Dashboard {...props} />
        )}
        {!blocked && activeTab === "Meine Kurse" && (
          <MyCourses {...props} setActiveTab={setActiveTab} />
        )}
        {!blocked && activeTab === "Mein Training" && <MemberTraining data={data} />}
        {!blocked && activeTab === "Zuhause" && <HomeWorkouts />}
        {!blocked && activeTab === "Profil" && (
          <MemberProfile {...props} onUserUpdate={updateUser} />
        )}
        {!blocked && activeTab === "Kurse" &&
          (isAdmin(user) ? <Courses {...props} /> : <TrainerAgenda {...props} />)}
        {!blocked && activeTab === "Mitarbeiter" && <Employees {...props} />}
        {!blocked && activeTab === "Zeiten" && (
          <section className="times-page">
            <AvailabilityEditor {...props} />
            <AbsenceForm {...props} />
            <LeaveRequests {...props} />
          </section>
        )}
        {!blocked && activeTab === "Studios" && <Studios {...props} />}
        {!blocked && activeTab === "Check-in" && <Attendance data={data} user={user} showError={setError} />}
        {!blocked && activeTab === "Statistik" && <StatsDashboard showError={setError} />}
        {!blocked && activeTab === "Benachrichtigungen" && (
          <MessagesPage {...props} />
        )}
        {activeTab === "Login" && (
          <Login
            user={user}
            data={data}
            setAuth={setAuth}
            setActiveTab={setActiveTab}
            showError={setError}
            refresh={() => refresh(false)}
          />
        )}
      </main>
      <footer className="app-footer">
        <Logo tone="light" size={34} />
        <span>
          {data.stats?.studios || 22} Studios am Niederrhein. Kurse montags bis
          freitags von 8 bis 20 Uhr.
        </span>
        {!user && (
          <button className="text-link light" onClick={() => goToSection("probetraining")}>
            Probetraining vereinbaren
          </button>
        )}
      </footer>
    </div>
  );
}

const pageTitles = {
  "Meine Kurse": "Meine Kurse",
  "Mein Training": "Mein Training",
  Zuhause: "Zuhause trainieren",
  Profil: "Mein Profil",
  Kurse: "Kurse verwalten",
  Zeiten: "Zeiten, Urlaub und Krankmeldungen",
  "Check-in": "Check-in im Kurs",
  Statistik: "Statistik",
  Mitarbeiter: "Mitarbeiter",
  Studios: "Unsere Studios",
  Benachrichtigungen: "Nachrichten",
};
