import {
  CalendarDays,
  ChartColumn,
  ClipboardList,
  FileText,
  Clock,
  Inbox,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageSquare,
  UserCog,
  UserRound,
  Users,
} from "lucide-react";
import { LogoMark } from "./Logo.jsx";

// Sidebar sections of the admin portal. Keys are the app's tab names.
export const ADMIN_NAV = [
  {
    group: "Betrieb",
    items: [
      ["Dashboard", "Übersicht", LayoutDashboard],
      ["Kursplan", "Kursplan", CalendarDays],
      ["Kurse", "Kurse verwalten", ClipboardList],
      ["Studios", "Studios", MapPin],
    ],
  },
  {
    group: "Menschen",
    items: [
      ["Mitglieder", "Mitglieder", Users],
      ["Mitarbeiter", "Mitarbeiter", UserCog],
      ["Zeiten", "Personalzeiten", Clock],
      ["Probetraining", "Probetraining", Inbox],
    ],
  },
  {
    group: "Auswertung",
    items: [
      ["Statistik", "Statistik", ChartColumn],
      ["Finanzbericht", "Finanzbericht", FileText],
    ],
  },
  {
    group: "Kommunikation",
    items: [["Benachrichtigungen", "Nachrichten", MessageSquare]],
  },
];

export const ADMIN_TITLES = Object.fromEntries(
  ADMIN_NAV.flatMap((g) => g.items.map(([key, label]) => [key, label])).concat([["Profil", "Mein Profil"]]),
);

/** Workspace for the studio management: sidebar navigation, page title and content. */
export default function AdminPortal({ user, page, setPage, unread, onLogout, sapphire, error, children }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <button className="admin-brand" onClick={() => setPage("Dashboard")} aria-label="Zur Übersicht">
          <LogoMark size={34} />
          <span>
            Fit &amp; Aktiv
            <small>Studioleitung</small>
          </span>
        </button>
        <nav aria-label="Admin-Navigation">
          {ADMIN_NAV.map((section) => (
            <div key={section.group} className="admin-nav-group">
              <span className="admin-nav-label">{section.group}</span>
              {section.items.map(([key, label, Icon]) => (
                <button
                  key={key}
                  className={`admin-nav-item ${page === key ? "active" : ""}`}
                  aria-current={page === key ? "page" : undefined}
                  onClick={() => setPage(key)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{label}</span>
                  {key === "Benachrichtigungen" && unread > 0 && <span className="count">{unread}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-account">
          <button className={`admin-nav-item ${page === "Profil" ? "active" : ""}`} onClick={() => setPage("Profil")}>
            <UserRound size={17} aria-hidden="true" />
            <span>
              {user.name}
              <small>Admin</small>
            </span>
          </button>
          <button className="admin-nav-item admin-logout" onClick={onLogout}>
            <LogOut size={17} aria-hidden="true" />
            <span>Abmelden</span>
          </button>
        </div>
      </aside>

      <main className="admin-main" data-accent={sapphire ? "sapphire" : undefined}>
        {page !== "Dashboard" && (
          <header className="admin-page-head">
            <h1>{ADMIN_TITLES[page]}</h1>
          </header>
        )}
        {error}
        {children}
      </main>
    </div>
  );
}
