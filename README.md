<div align="center">

<img src="frontend/public/favicon.svg" width="72" alt="Fit & Aktiv logo" />

# Fit & Aktiv

**A full-stack course-planning and member platform for a chain of 22 gyms.**

Public website, member area with online booking, a trainer workspace with QR
check-in, and an admin portal with statistics and a monthly finance report (BWA) as PDF.

![React](https://img.shields.io/badge/React-19-20232a?logo=react&logoColor=61dafb)
![Vite](https://img.shields.io/badge/Vite-8-20232a?logo=vite&logoColor=ffd62e)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-20232a?logo=tailwindcss&logoColor=38bdf8)
![Python](https://img.shields.io/badge/Python-3-20232a?logo=python&logoColor=ffd43b)
![Flask](https://img.shields.io/badge/Flask-3-20232a?logo=flask&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-20232a?logo=sqlite&logoColor=74c0fc)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9-20232a?logo=leaflet&logoColor=a3e635)

<img src="docs/screenshots/01-homepage.jpg" alt="Fit & Aktiv homepage" width="900" />

</div>

---

## Contents

- [About the project](#about-the-project)
- [Features](#features)
- [Technical highlights](#technical-highlights)
- [Screenshots](#screenshots)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Demo accounts](#demo-accounts)
- [API overview](#api-overview)
- [Project structure](#project-structure)
- [What I would do next](#what-i-would-do-next)
- [Credits](#credits)

## About the project

Fit & Aktiv is a fictional gym chain with **22 studios on the Lower Rhine**
(Krefeld, Düsseldorf, Mönchengladbach, Duisburg, Essen and more). The
application covers the whole course business of such a chain:

- **Visitors** discover the studios on a map, browse the course offer and the
  live timetable, and request a free trial session.
- **Members** log in, see the timetable of their home studio, book and cancel
  places in courses, and manage their personal data.
- **Trainers** see their own shifts, set their availability, request leave,
  report sick days, and check in participants by scanning their membership card.
- **Admins** work in their own portal: plan courses, manage members, staff and
  studios, follow up trial requests, read statistics and print the monthly finance report.

The demo database contains 22 studios, 44 rooms, 110 staff accounts, 5 course types,
about **25,000 members**, roughly **11,500 generated courses** for the current year,
19,000 bookings and a year of expenses.

## Features

### Public website
- Hero, introduction and photo sections in a dark, premium design
- **Interactive studio map** (Leaflet + OpenStreetMap) with a synced studio list;
  selecting a studio jumps to its timetable
- Course offer presented as cards that stack while scrolling
- **Weekly timetable** for all studios with week navigation and studio filter
- **Trial-session form**: saved in the database and delivered to admins as a notification

### Member area
- Self-service **registration** and login (separate from staff accounts)
- Opens on the **timetable of the member's home studio**, with filters and favourites
- **Course booking** in a dialog showing time, room, trainer and free places
- **Waiting list** with automatic promotion and a 2-hour cancellation deadline
- Server-side rules: room capacity, no double booking, no booking of cancelled
  or already started courses
- "My courses" with cancellation, ratings and calendar export (.ics), plus a
  split-flap board showing the next booked course
- **Mein Training**: attended courses, streaks and hours per month and course type
- **Home workouts**: 29 exercises with start and end photos and five guided routines with a timer
- **Membership**: four plans, plan change from next month, pauses (max. 3 months a
  year) and a **digital membership card with QR code**

### Trainer workspace
- Personal timetable with the next course (tinted in its course colour), a two-week
  calendar of working days (Monday to Friday) and a month overview
- **Weekly availability** for the next four weeks, checked against contract hours
- **Leave requests** with admin approval, and sick notes with automatic replacement search
- **QR check-in**: scan the members' cards with the phone camera, or tick them off by hand
- Participant list per course and messages to all participants

### Admin portal
- Own workspace with a sidebar: Betrieb, Menschen, Auswertung, Kommunikation
- **Übersicht**: what is waiting (trial requests, leave requests, courses without a
  trainer), this month's finances, today's operations, studio occupancy and trainer workload
- **Members**: search over 25,000 members, filters by studio and plan, detail view and plan changes
- **Staff**: create and delete staff, edit monthly salaries in place, staff hours
- **Courses**: create, cancel and delete courses, assign trainers with
  **conflict checking**, generators for random weekly or yearly schedules
- **Trial requests** with a status workflow (new, contacted, done)
- **Statistics** in three tabs: finances (revenue, costs, result per studio),
  members (growth, plans, pauses) and courses (occupancy, no-shows, ratings, busiest times)
- **Finanzbericht**: a monthly BWA (*Betriebswirtschaftliche Auswertung*, the
  report German accountants use) as a two-page A4 PDF, with income statement,
  cost centres per studio and VAT; expenses such as maintenance and repairs are recorded on the same page
- **Email outbox** (simulated locally) for waiting-list promotions, trainer changes and cancellations
- **Live sync**: the UI refreshes every 2 seconds, so edits made directly in the
  SQLite file (e.g. in *DB Browser for SQLite*) appear on the site almost immediately

## Technical highlights

**Replacement-trainer search.** When a trainer reports sick, every affected
course is checked against all other trainers. A candidate must:

1. hold the course's required qualification,
2. not be absent on that day,
3. have a stored availability window covering the course,
4. stay below their weekly limit, and below their monthly limit
   (20 courses for full-time, 10 for part-time staff),
5. have no overlapping course, with a **60-minute travel buffer** when switching studios,
6. be allowed to travel if the course is outside their home studio.

Valid candidates are ranked (same studio first, then mobility, then lowest
current workload). Courses with candidates are marked *replacement needed*;
courses without any are cancelled automatically, and admins are notified. When
the trainer marks themselves available again, untouched courses are handed back to them.

**Fast schedule generation.** On first start the backend fills the whole
current year (about 11,000 courses) in roughly 1.5 seconds. It does this with
in-memory indexes for availability, absences, weekly and monthly load and daily
time slots, instead of one database query per check.

**Two kinds of accounts on one token system.** Login tokens are signed with
HMAC-SHA256 and expire after 7 days. Member tokens are marked separately from staff tokens because both
tables use overlapping IDs, so a member can never reach a staff endpoint.
`/api/data` only returns what the caller may see: visitors get no staff data,
members get their own profile and bookings, and admins get everything.

**Password security.** Passwords are never stored in plain text: they are saved
as salted scrypt hashes (`werkzeug.security`) on registration, password change and
when an admin creates staff. New passwords need at least 8 characters. After 5 failed
logins for the same e-mail and IP address, further attempts are blocked for 15 minutes.
When a token expires, the frontend ends the session and shows the login again.

**Finance from the operational data.** Revenue comes from each member's plan and
pauses per month; costs are salaries plus the employer's social security share
(a flat 21 %), rent and energy per studio, and the recorded expenses. The same
numbers feed the overview, the statistics and the BWA, so they always agree.
Salaries are never sent to trainers.

**Safe schema migrations.** Existing databases are upgraded on startup (new
columns, map coordinates, member logins, plain-text passwords converted to hashes),
so old data keeps working.

**Frontend.** React 19 with Vite 8, Tailwind CSS 4 and shadcn, plus selected
components from the [Componentry](https://componentry.fun) registry. The
original stylesheet is loaded into a CSS cascade layer, so it coexists with
Tailwind utilities without conflicts. The layout is responsive down to 390 px phone width.

**Two accent colours.** The design uses champagne gold and a muted sapphire blue.
Pages alternate between the two in menu order, starting with gold, and each page
uses its colour throughout (buttons, links, active states, dialogs). The top bar and
the admin sidebar always stay gold, so the brand stays constant.

## Screenshots

### Public website

| Studio map | Course offer |
|---|---|
| ![Studio map](docs/screenshots/02-studio-map.jpg) | ![Course offer](docs/screenshots/03-course-offer.jpg) |
| **Public timetable** | **Trial-session request** |
| ![Timetable](docs/screenshots/04-public-timetable.jpg) | ![Trial session](docs/screenshots/05-trial-session.jpg) |
| **Login (members and staff)** | **Mobile** |
| ![Login](docs/screenshots/06-login.jpg) | <img src="docs/screenshots/13-mobile-home.jpg" width="190" />  |

### Member area

| Member dashboard | Booking a course |
|---|---|
| ![Member dashboard](docs/screenshots/07-member-dashboard.jpg) | ![Booking dialog](docs/screenshots/08-booking-dialog.jpg) |
| **My bookings** | **Mein Training** |
| ![My bookings](docs/screenshots/09-my-bookings.jpg) | ![My training](docs/screenshots/21-my-training.jpg) |
| **Home workouts** | **Membership card and plan** |
| ![Home workouts](docs/screenshots/22-home-workouts.jpg) | ![Membership](docs/screenshots/23-membership.jpg) |

### Trainer workspace

| Own timetable | QR check-in |
|---|---|
| ![Trainer agenda](docs/screenshots/19-trainer-agenda.jpg) | ![Check-in](docs/screenshots/20-check-in.jpg) |

### Admin portal

| Übersicht | Statistics |
|---|---|
| ![Admin overview](docs/screenshots/10-admin-overview.jpg) | ![Statistics](docs/screenshots/15-statistics.jpg) |
| **Finanzbericht (BWA)** | **Members** |
| ![Finance report](docs/screenshots/16-finance-report.jpg) | ![Member directory](docs/screenshots/17-member-directory.jpg) |
| **Course management** | **Staff and salaries** |
| ![Course management](docs/screenshots/11-course-management.jpg) | ![Staff management](docs/screenshots/12-staff-management.jpg) |
| **Trial requests** | |
| ![Trial requests](docs/screenshots/18-trial-requests.jpg) | |

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, shadcn, Componentry components, Framer Motion, GSAP, Leaflet, lucide icons |
| Backend | Python 3, Flask 3, Flask-CORS, REST/JSON API |
| Database | SQLite (18 tables with foreign keys, created and migrated automatically) |
| Auth | Salted scrypt password hashes, HMAC-SHA256 signed bearer tokens with expiry, login rate limiting, role checks per endpoint |
| Maps and media | OpenStreetMap tiles, Unsplash photography |

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        UI["React SPA<br/>(Vite, Tailwind)"]
    end
    subgraph Backend["Flask REST API"]
        AUTH["Auth and roles<br/>(HMAC tokens)"]
        PLAN["Scheduling logic<br/>replacement search,<br/>conflict checks, generator"]
        BOOK["Bookings, waiting list,<br/>check-in, trial requests"]
        FIN["Statistics and<br/>finance report"]
    end
    DB[("SQLite<br/>fitaktiv.db")]
    OSM["OpenStreetMap<br/>tiles"]

    UI -- "JSON over HTTP<br/>(polling every 2 s)" --> AUTH
    AUTH --> PLAN
    AUTH --> BOOK
    PLAN --> DB
    BOOK --> DB
    AUTH --> FIN
    FIN --> DB
    UI -- "map tiles" --> OSM
```

### Data model

```mermaid
erDiagram
    STUDIOS ||--o{ ROOMS : has
    STUDIOS ||--o{ EMPLOYEES : "home studio of"
    STUDIOS ||--o{ MEMBERS : "home studio of"
    STUDIOS ||--o{ TRIAL_REQUESTS : "requested for"
    ROOMS ||--o{ COURSES : hosts
    COURSE_TYPES ||--o{ COURSES : "type of"
    EMPLOYEES ||--o{ COURSES : teaches
    EMPLOYEES ||--o{ AVAILABILITIES : "is available"
    EMPLOYEES ||--o{ ABSENCES : "reports"
    EMPLOYEES ||--o{ NOTIFICATIONS : receives
    EMPLOYEES ||--o{ LEAVE_REQUESTS : requests
    STUDIOS ||--o{ EXPENSES : "booked to"
    MEMBERS ||--o{ BOOKINGS : makes
    MEMBERS ||--o{ MEMBERSHIP_PAUSES : takes
    MEMBERS ||--o{ FAVORITES : marks
    MEMBERS ||--o{ RATINGS : gives
    COURSES ||--o{ BOOKINGS : "booked in"
    COURSES ||--o{ RATINGS : "rated in"
```

## Getting started

**Requirements:** Python 3.10+ and Node.js 20+.

### Quick start (macOS / Linux)

```bash
./start_backend_mac.sh    # terminal 1: creates a venv, installs Flask, starts the API on :5000
./start_frontend_mac.sh   # terminal 2: installs npm packages, starts Vite on :5173
```

Then open **http://localhost:5173**.

### Manual setup

```bash
# Backend
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python3 app.py                    # API on http://localhost:5000

# Frontend (second terminal)
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

### Phone demo over HTTPS

```bash
cd frontend && FITAKTIV_LAN=1 npm run dev   # https://<laptop-ip>:5173
```

Phones only allow the camera (for the QR check-in) on secure pages, so this mode
serves the app over HTTPS with a self-signed certificate. The phone warns once;
accept it to continue. API calls go through the Vite proxy, so the backend stays local.

On first start, the backend creates `backend/fitaktiv.db` with all demo data
and generates the current year's courses. To start over with fresh data,
delete the file and start the backend again.

| Environment variable | Purpose | Default |
|---|---|---|
| `FITAKTIV_AUTH_SECRET` | Secret used to sign login tokens | development value |
| `FITAKTIV_AUTO_YEAR_COURSES` | Set to `0` to skip generating the yearly schedule | `1` |
| `FITAKTIV_LAN` | Set to `1` to serve the frontend over HTTPS in the home network | off |

## Demo accounts

All demo accounts use the password **`pass123`**. Passwords you set yourself
(registration, password change, new staff) need at least 8 characters.

| Role | E-mail |
|---|---|
| Admin | `lisa.weber@fit-aktiv.local` |
| Trainer | `max.bauer@fit-aktiv.local` (all 110 staff logins: see [LOGIN_DETAILS.md](LOGIN_DETAILS.md)) |
| Member | `philipp.winter.2@example.local` (with booking history), `mitglied01@example.local` … `mitglied30@example.local`, or register a new account |

Choose **Mitglied** (member) or **Mitarbeiter** (staff) on the login page.

## API overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/data` | everyone (filtered by role) | Studios, rooms, courses, stats, plus role-specific data |
| `POST` | `/api/login` | everyone | Log in as member or employee (rate limited) |
| `POST` | `/api/members/register` | everyone | Create a member account |
| `PATCH` | `/api/members/me` | member | Update own profile and password |
| `POST`, `DELETE` | `/api/courses/<id>/booking` | member | Book or cancel a course place |
| `POST` | `/api/trial-requests` | everyone | Request a trial session |
| `POST`, `DELETE` | `/api/courses/<id>/waitlist` | member | Join or leave the waiting list |
| `PUT`, `DELETE` | `/api/members/me/membership` | member | Change plan from next month, or cancel the change |
| `POST`, `DELETE` | `/api/members/me/pauses[/<id>]` | member | Pause the membership |
| `POST`, `DELETE` | `/api/members/me/favorites` | member | Favourite courses and trainers |
| `POST` | `/api/courses/<id>/rating` | member | Rate an attended course |
| `GET` | `/api/attendance/today` | staff | Today's courses for check-in |
| `POST` | `/api/courses/<id>/scan` | staff | Check in a member by QR code |
| `PUT` | `/api/employees/<id>/availability` | admin or the trainer themselves | Weekly availability |
| `POST`, `DELETE` | `/api/leave-requests[/<id>]` | staff | Request planned leave |
| `POST` | `/api/leave-requests/<id>/decision` | admin | Approve or reject leave |
| `GET` | `/api/stats` | admin | Statistics for all three tabs |
| `GET` | `/api/admin/overview` | admin | Data for the Übersicht page |
| `GET`, `PATCH` | `/api/admin/members[/<id>]` | admin | Search members, view and change plans |
| `GET` | `/api/admin/finance?month=` | admin | Monthly BWA figures |
| `POST`, `DELETE` | `/api/admin/expenses[/<id>]` | admin | Record expenses |
| `GET`, `PATCH` | `/api/admin/trial-requests[/<id>]` | admin | Trial requests and their status |
| `GET` | `/api/emails` | admin | Simulated email outbox |
| `POST`, `PATCH`, `DELETE` | `/api/courses[/<id>]` | admin | Create, edit and delete courses |
| `POST` | `/api/courses/<id>/assign` | admin | Assign a trainer (with conflict check) |
| `POST` | `/api/courses/<id>/cancel` | admin | Cancel a course |
| `GET` | `/api/replacements?course_id=` | admin | Ranked replacement candidates |
| `POST` | `/api/courses/generate-week`, `/generate-year` | admin | Generate random schedules |
| `POST`, `PATCH`, `DELETE` | `/api/employees[/<id>]` | admin | Manage staff |
| `POST` | `/api/employees/<id>/absence` | admin or the trainer themselves | Sick note and automatic replacement search |
| `POST` | `/api/employees/<id>/available` | admin or the trainer themselves | Back to work, restore own courses |
| `POST` | `/api/studios` | admin | Add a studio |
| `POST` | `/api/notifications/<id>/read` | staff | Mark a notification as read |

## Project structure

```text
Fit-Aktiv/
├── backend/
│   ├── app.py              # Flask API: auth, scheduling, booking, statistics, finance
│   ├── database.py         # schema, migrations and demo data
│   └── requirements.txt
├── frontend/
│   ├── public/images/      # photography and exercise photos
│   ├── src/
│   │   ├── App.jsx         # app shell, routing by role, staff pages, login
│   │   ├── Home.jsx        # public homepage and trial-session form
│   │   ├── MemberArea.jsx  # member dashboard, bookings, profile
│   │   ├── Membership*.jsx # plans, pauses, digital membership card
│   │   ├── MemberTraining.jsx, HomeWorkouts.jsx
│   │   ├── TrainerAgenda.jsx, Availability.jsx, LeaveRequests.jsx, Attendance.jsx
│   │   ├── AdminPortal.jsx # admin sidebar and layout
│   │   ├── AdminOverview.jsx, AdminMembers.jsx, AdminTrials.jsx
│   │   ├── StatsDashboard.jsx, FinanceReport.jsx
│   │   ├── WeekPlan.jsx    # weekly timetable shared by all roles
│   │   ├── StudioMap.jsx   # Leaflet studio map
│   │   ├── components/ui/  # shadcn and Componentry components
│   │   ├── api.js          # API client
│   │   └── styles.css      # design system (dark theme, print styles for the BWA)
│   └── package.json
├── docs/screenshots/
├── start_backend_mac.sh
└── start_frontend_mac.sh
```


## Credits

- Photos from [Unsplash](https://unsplash.com) (Unsplash License)
- Home workout photos (start and end position) from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) (public domain, Unlicense)
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- UI components from [shadcn/ui](https://ui.shadcn.com) and [Componentry](https://componentry.fun)

---

<div align="center">

Built by **Amine Toumi** · [GitHub @toumiamine12](https://github.com/toumiamine12)

</div>
