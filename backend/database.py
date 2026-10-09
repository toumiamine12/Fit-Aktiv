import random
import sqlite3
import re
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

from werkzeug.security import generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "fitaktiv.db"

COURSE_TYPES = [
    ("Yoga", "Yoga"),
    ("Pilates", "Pilates"),
    ("Spinning", "Spinning"),
    ("Krafttraining", "Krafttraining"),
    ("Functional Fit", "Functional Fit"),
]

STUDIO_CITIES = [
    "Krefeld Zentrum", "Krefeld Nord", "Krefeld Süd", "Mönchengladbach", "Düsseldorf", "Neuss",
    "Viersen", "Kempen", "Willich", "Meerbusch", "Duisburg", "Essen", "Oberhausen", "Ratingen",
    "Moers", "Geldern", "Grefrath", "Nettetal", "Tönisvorst", "Dormagen", "Kaarst", "Hilden"
]

# Approximate map positions (latitude, longitude) for the studio map.
STUDIO_COORDS = {
    "Krefeld Zentrum": (51.3331, 6.5623), "Krefeld Nord": (51.3655, 6.5480),
    "Krefeld Süd": (51.3030, 6.5780), "Mönchengladbach": (51.1805, 6.4428),
    "Düsseldorf": (51.2277, 6.7735), "Neuss": (51.2042, 6.6879),
    "Viersen": (51.2556, 6.3917), "Kempen": (51.3644, 6.4194),
    "Willich": (51.2633, 6.5492), "Meerbusch": (51.2570, 6.6830),
    "Duisburg": (51.4344, 6.7623), "Essen": (51.4556, 7.0116),
    "Oberhausen": (51.4963, 6.8638), "Ratingen": (51.2973, 6.8493),
    "Moers": (51.4516, 6.6408), "Geldern": (51.5197, 6.3236),
    "Grefrath": (51.3361, 6.3403), "Nettetal": (51.3040, 6.2770),
    "Tönisvorst": (51.3206, 6.4933), "Dormagen": (51.0963, 6.8405),
    "Kaarst": (51.2297, 6.6175), "Hilden": (51.1714, 6.9394),
}

FIRST_NAMES = [
    "Lisa", "Max", "Anna", "Jonas", "Sara", "Tim", "Mia", "Lukas", "Lea", "Noah",
    "Emma", "Ben", "Sofia", "Paul", "Lina", "Finn", "Marie", "Elias", "Nina", "Leon",
    "Laura", "Felix", "Hanna", "Tom", "Clara", "David", "Amir", "Yara", "Mila", "Omar"
]
LAST_NAMES = [
    "Fit", "Müller", "Weber", "Klein", "Bauer", "Schmidt", "Fischer", "Wagner", "Becker", "Hoffmann",
    "Schulz", "Koch", "Richter", "Wolf", "Neumann", "Schwarz", "Zimmermann", "Braun", "Krüger", "Hartmann"
]


def login_email_for_name(name: str, domain: str = "fit-aktiv.local") -> str:
    replacements = {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "ae", "Ö": "oe", "Ü": "ue", "ß": "ss"}
    for old, new in replacements.items():
        name = name.replace(old, new)
    slug = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".")
    return f"{slug}@{domain}"


MEMBERSHIP_TYPES = ["basic", "plus", "premium", "young"]

# Informal phrases in stored messages and their polite ("Sie") versions.
SIE_REWRITES = [
    ("Du übernimmst als Ersatztrainer:", "Sie übernehmen als Ersatztrainer:"),
    ("Du wurdest als Ersatztrainer für", "Sie wurden als Ersatztrainer für"),
    ("Du wurdest eingeteilt:", "Sie wurden eingeteilt:"),
    ("Du wurdest ", "Sie wurden "),
    ("Du bist wieder als verfügbar markiert.", "Sie sind wieder als verfügbar markiert."),
    ("Du bist vom ", "Sie sind vom "),
    ("deiner Kurse wurden wieder dir zugeordnet.", "Ihrer Kurse wurden Ihnen wieder zugeordnet."),
    ("Du bist nachgerückt: Dein Platz", "Sie sind nachgerückt: Ihr Platz"),
    ("Wir hoffen, dich bald", "Wir hoffen, Sie bald"),
]

MEMBER_FIRST_NAMES = [
    "Julia", "Jan", "Katharina", "Moritz", "Sophie", "Niklas", "Johanna", "Simon", "Charlotte", "Fabian",
    "Alina", "Tobias", "Greta", "Philipp", "Helena", "Jakob", "Pia", "Daniel", "Merle", "Sebastian",
    "Ida", "Kevin", "Romy", "Julian", "Ella", "Marco", "Selin", "Can", "Aylin", "Dennis",
    "Vanessa", "Robin", "Theresa", "Henrik", "Luisa", "Matteo", "Zeynep", "Patrick", "Frieda", "Erik",
]
MEMBER_LAST_NAMES = [
    "Schneider", "Meyer", "Schröder", "Lange", "Krause", "Lehmann", "Köhler", "Herrmann", "König", "Walter",
    "Peters", "Möller", "Jung", "Hahn", "Vogel", "Friedrich", "Keller", "Günther", "Frank", "Berger",
    "Roth", "Beck", "Lorenz", "Baumann", "Franke", "Albrecht", "Simon", "Ludwig", "Böhm", "Winter",
    "Kraus", "Martin", "Schumacher", "Yilmaz", "Kaya", "Arslan", "Nowak", "Jansen", "Engel", "Busch",
]


def seed_demo_members(conn, per_studio: int = 12) -> int:
    """Demo members with bookings (3 weeks back to 4 weeks ahead), added once. Returns the number of bookings."""
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_members_v1'").fetchone():
        return 0
    rng = random.Random(42)
    ts = now_iso()
    today = date.today()
    first, last = (today - timedelta(days=21)).isoformat(), (today + timedelta(days=28)).isoformat()
    studios = [r["id"] for r in cur.execute("SELECT id FROM studios ORDER BY id").fetchall()]
    used = {r["email"] for r in cur.execute("SELECT email FROM members").fetchall()}
    booked = {
        r["course_id"]: r["n"]
        for r in cur.execute("SELECT course_id, COUNT(*) AS n FROM bookings WHERE status = 'booked' GROUP BY course_id")
    }
    bookings = 0
    for studio_id in studios:
        courses = cur.execute(
            """
            SELECT c.id, c.date, r.capacity FROM courses c JOIN rooms r ON r.id = c.room_id
            WHERE r.studio_id = ? AND c.status = 'active' AND c.date BETWEEN ? AND ?
            """,
            (studio_id, first, last),
        ).fetchall()
        for _ in range(per_studio):
            name = f"{rng.choice(MEMBER_FIRST_NAMES)} {rng.choice(MEMBER_LAST_NAMES)}"
            email, n = login_email_for_name(name, "example.local"), 2
            while email in used:
                email, n = login_email_for_name(f"{name} {n}", "example.local"), n + 1
            used.add(email)
            cur.execute(
                "INSERT INTO members (name, email, password, phone, home_studio_id, updated_at) VALUES (?, ?, 'pass123', ?, ?, ?)",
                (name, email, f"0151 {rng.randint(1000000, 9999999)}", studio_id, ts),
            )
            member_id = cur.lastrowid
            for course in rng.sample(courses, min(len(courses), rng.randint(3, 8))):
                if booked.get(course["id"], 0) >= course["capacity"]:
                    continue
                booked[course["id"]] = booked.get(course["id"], 0) + 1
                booked_on = date.fromisoformat(course["date"]) - timedelta(days=rng.randint(1, 10))
                cur.execute(
                    "INSERT INTO bookings (member_id, course_id, booking_date, status, updated_at) VALUES (?, ?, ?, 'booked', ?)",
                    (member_id, course["id"], f"{booked_on.isoformat()} 09:00:00", ts),
                )
                bookings += 1
    backfill_memberships(cur)
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_members_v1', ?)", (ts,))
    conn.commit()
    return bookings


def seed_demo_attendance(conn) -> int:
    """Attendance for about 85 % of the bookings of courses that are over, added once (gives a realistic no-show rate)."""
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_attendance_v1'").fetchone():
        return 0
    rng = random.Random(11)
    rows = cur.execute(
        """
        SELECT b.id FROM bookings b JOIN courses c ON c.id = b.course_id
        WHERE b.status = 'booked' AND c.status = 'active' AND c.date < ?
        """,
        (date.today().isoformat(),),
    ).fetchall()
    added = 0
    for row in rows:
        if rng.random() < 0.85:
            cur.execute("UPDATE bookings SET attended = 1 WHERE id = ?", (row["id"],))
            added += 1
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_attendance_v1', ?)", (now_iso(),))
    conn.commit()
    return added


# How full a course usually is, by start hour (morning and evening courses are the popular ones).
COURSE_POPULARITY = {8: 0.62, 10: 0.38, 12: 0.5, 17: 0.82, 19: 0.74}


EXPENSE_CATEGORIES = {
    "wartung": "Wartung",
    "reparatur": "Reparatur",
    "reinigung": "Reinigung",
    "geraete": "Geräte und Ausstattung",
    "marketing": "Marketing",
    "verwaltung": "Verwaltung und IT",
    "sonstiges": "Sonstiges",
}

REPAIRS = [
    "Laufband: Antriebsriemen getauscht",
    "Spinningbike: Tretlager erneuert",
    "Duschen: Thermostat repariert",
    "Kabelzug: Seil ersetzt",
    "Beleuchtung Kursraum A erneuert",
    "Lüftungsanlage: Filterwechsel außerplanmäßig",
    "Spiegelwand Kursraum B ersetzt",
]


def seed_demo_expenses(conn) -> int:
    """Running costs since January (cleaning, servicing, repairs, marketing, IT), added once."""
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_expenses_v1'").fetchone():
        return 0
    rng = random.Random(31)
    today = date.today()
    studios = [r["id"] for r in cur.execute("SELECT id FROM studios")]
    rows = []
    # From January (for the year-to-date figures), at least six months back (for the charts).
    month = today.replace(day=1)
    for _ in range(5):
        month = (month - timedelta(days=1)).replace(day=1)
    month = min(month, today.replace(month=1, day=1))
    while month <= today:
        def day(d):
            return min(month.replace(day=d), today).isoformat()
        for sid in studios:
            rows.append((day(1), sid, "reinigung", "Reinigungsvertrag (monatlich)", round(rng.uniform(950, 1350), 2)))
            rows.append((day(8), sid, "wartung", "Wartungsvertrag Trainingsgeräte", round(rng.uniform(280, 620), 2)))
            if rng.random() < 0.35:
                rows.append((day(rng.randint(2, 27)), sid, "reparatur", rng.choice(REPAIRS), round(rng.uniform(150, 1800), 2)))
            if rng.random() < 0.15:
                rows.append((day(rng.randint(2, 27)), sid, "geraete", "Kleingeräte (Matten, Kettlebells, Bänder)", round(rng.uniform(300, 1400), 2)))
        rows.append((day(3), None, "marketing", "Online-Werbung und Flyer", round(rng.uniform(2500, 4200), 2)))
        rows.append((day(1), None, "verwaltung", "Software, Buchhaltung, Telefon", 1640.0))
        month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    rows = [r for r in rows if r[0] <= today.isoformat()]
    cur.executemany(
        "INSERT INTO expenses (date, studio_id, category, description, amount_net, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [(*r, now_iso()) for r in rows],
    )
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_expenses_v1', ?)", (now_iso(),))
    conn.commit()
    return len(rows)


def member_target(studio_id: int) -> int:
    """Demo member base per studio, 950 to 1,350, so studios differ like real ones."""
    return 950 + (studio_id * 173) % 400


def seed_demo_member_base(conn) -> int:
    """Fill each studio up to a realistic member base (real studios have about 800 to 1,500 members), added once.
    These members have no bookings; they only make revenue and the cost ratio realistic."""
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_member_base_v2'").fetchone():
        return 0
    rng = random.Random(78)
    today = date.today()
    ts = now_iso()
    plans = ["plus"] * 40 + ["premium"] * 25 + ["young"] * 15 + ["basic"] * 20
    used = {r["email"] for r in cur.execute("SELECT email FROM members")}
    rows = []
    for st in cur.execute("SELECT s.id, (SELECT COUNT(*) FROM members m WHERE m.home_studio_id = s.id) AS n FROM studios s").fetchall():
        for _ in range(max(0, member_target(st["id"]) - st["n"])):
            name = f"{rng.choice(MEMBER_FIRST_NAMES)} {rng.choice(MEMBER_LAST_NAMES)}"
            email, n = login_email_for_name(name, "example.local"), 2
            while email in used:
                email, n = login_email_for_name(f"{name} {n}", "example.local"), n + 1
            used.add(email)
            since = today.replace(day=1)
            for _ in range(rng.randint(0, 59)):
                since = (since - timedelta(days=1)).replace(day=1)
            rows.append((name, email, f"0151 {rng.randint(1000000, 9999999)}", st["id"], rng.choice(plans), since.isoformat(), ts))
    cur.executemany(
        """
        INSERT INTO members (name, email, password, phone, home_studio_id, membership_type, member_since, updated_at)
        VALUES (?, ?, 'pass123', ?, ?, ?, ?, ?)
        """,
        rows,
    )
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_member_base_v2', ?)", (ts,))
    conn.commit()
    return len(rows)


DEMO_TRIAL_MESSAGES = [
    "Ich möchte nach einer Knieverletzung langsam wieder einsteigen.",
    "Gibt es auch Kurse am frühen Morgen?",
    "Wir würden gerne zu zweit kommen.",
    "",
    "Ich habe noch nie Pilates gemacht, ist das für Anfänger geeignet?",
    "",
    "Am liebsten nach Feierabend, ab 17 Uhr.",
]


def seed_demo_trials(conn) -> int:
    """About a dozen trial-session requests from the website over the last three weeks, added once."""
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_trials_v1'").fetchone():
        return 0
    rng = random.Random(5)
    studios = [r["id"] for r in cur.execute("SELECT id FROM studios")]
    types = [r["id"] for r in cur.execute("SELECT id FROM course_types")]
    today = date.today()
    for i in range(12):
        name = f"{rng.choice(MEMBER_FIRST_NAMES)} {rng.choice(MEMBER_LAST_NAMES)}"
        created = today - timedelta(days=rng.randint(0, 20), hours=0)
        status = "neu" if i < 4 else rng.choice(["kontaktiert", "erledigt", "erledigt"])
        cur.execute(
            """
            INSERT INTO trial_requests (name, email, phone, studio_id, course_type_id, preferred_date, message, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                login_email_for_name(name, "beispiel.de"),
                f"0170 {rng.randint(1000000, 9999999)}" if rng.random() < 0.7 else None,
                rng.choice(studios),
                rng.choice(types) if rng.random() < 0.7 else None,
                (created + timedelta(days=rng.randint(3, 10))).isoformat() if rng.random() < 0.6 else None,
                rng.choice(DEMO_TRIAL_MESSAGES),
                status,
                f"{created.isoformat()} {rng.randint(8, 21):02d}:{rng.randint(0, 59):02d}:00",
            ),
        )
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_trials_v1', ?)", (now_iso(),))
    conn.commit()
    return 12


def seed_demo_volume(conn, per_studio: int = 180) -> int:
    """A realistic member base and course occupancy for the dashboard, added once.

    About 180 extra members per studio, and bookings for every course from four weeks back to two weeks ahead,
    filled by start-hour popularity. Past courses get check-ins (about 85 %) and some cancellations (about 6 %).
    Basic members are created but get no extra bookings, so their 4-courses-a-month rule holds.
    """
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_volume_v1'").fetchone():
        return 0
    rng = random.Random(99)
    ts = now_iso()
    today = date.today()
    used = {r["email"] for r in cur.execute("SELECT email FROM members").fetchall()}
    plans = ["plus"] * 40 + ["premium"] * 25 + ["young"] * 15 + ["basic"] * 20
    pools: Dict[int, List[int]] = {}
    for studio_id in [r["id"] for r in cur.execute("SELECT id FROM studios ORDER BY id")]:
        for _ in range(per_studio):
            name = f"{rng.choice(MEMBER_FIRST_NAMES)} {rng.choice(MEMBER_LAST_NAMES)}"
            email, n = login_email_for_name(name, "example.local"), 2
            while email in used:
                email, n = login_email_for_name(f"{name} {n}", "example.local"), n + 1
            used.add(email)
            plan = rng.choice(plans)
            since = today.replace(day=1)
            for _ in range(rng.randint(0, 47)):
                since = (since - timedelta(days=1)).replace(day=1)
            cur.execute(
                """
                INSERT INTO members (name, email, password, phone, home_studio_id, membership_type, member_since, updated_at)
                VALUES (?, ?, 'pass123', ?, ?, ?, ?, ?)
                """,
                (name, email, f"0151 {rng.randint(1000000, 9999999)}", studio_id, plan, since.isoformat(), ts),
            )
            if plan != "basic":
                pools.setdefault(studio_id, []).append(cur.lastrowid)

    courses = cur.execute(
        """
        SELECT c.id, c.date, c.start_time, r.capacity, r.studio_id,
               (SELECT COUNT(*) FROM bookings b WHERE b.course_id = c.id AND b.status IN ('booked', 'waiting')) AS taken
        FROM courses c JOIN rooms r ON r.id = c.room_id
        WHERE c.status = 'active' AND c.date BETWEEN ? AND ?
        """,
        ((today - timedelta(days=28)).isoformat(), (today + timedelta(days=14)).isoformat()),
    ).fetchall()
    rows = []
    for c in courses:
        pool = pools.get(c["studio_id"], [])
        popularity = COURSE_POPULARITY.get(int(c["start_time"][:2]), 0.45)
        target = min(c["capacity"], round(c["capacity"] * popularity * rng.uniform(0.75, 1.1)))
        past = c["date"] < today.isoformat()
        for member_id in rng.sample(pool, max(0, min(len(pool), target - c["taken"]))):
            booked_on = date.fromisoformat(c["date"]) - timedelta(days=rng.randint(1, 10))
            cancelled = rng.random() < 0.06
            attended = 1 if past and not cancelled and rng.random() < 0.85 else None
            rows.append((member_id, c["id"], f"{booked_on.isoformat()} 09:00:00", "cancelled" if cancelled else "booked", attended, ts))
    cur.executemany(
        "INSERT INTO bookings (member_id, course_id, booking_date, status, attended, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_volume_v1', ?)", (ts,))
    conn.commit()
    return len(rows)


def seed_demo_cancellations(conn) -> int:
    """About 7 % of the demo bookings were cancelled by the member, added once (gives a realistic cancellation rate)."""
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_cancellations_v1'").fetchone():
        return 0
    rng = random.Random(23)
    ids = [r["id"] for r in cur.execute("SELECT id FROM bookings WHERE status = 'booked' AND attended IS NULL").fetchall()]
    chosen = [i for i in ids if rng.random() < 0.07]
    cur.executemany("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?", [(now_iso(), i) for i in chosen])
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_cancellations_v1', ?)", (now_iso(),))
    conn.commit()
    return len(chosen)


def seed_demo_ratings(conn) -> int:
    """Ratings for about two thirds of the bookings of courses that are over, added once."""
    cur = conn.cursor()
    if cur.execute("SELECT value FROM app_settings WHERE key = 'demo_ratings_v1'").fetchone():
        return 0
    rng = random.Random(7)
    rows = cur.execute(
        """
        SELECT b.member_id, b.course_id, c.date FROM bookings b JOIN courses c ON c.id = b.course_id
        WHERE b.status = 'booked' AND c.status = 'active' AND c.date < ?
        """,
        (date.today().isoformat(),),
    ).fetchall()
    added = 0
    for row in rows:
        if rng.random() < 0.65:
            cur.execute(
                "INSERT OR IGNORE INTO ratings (member_id, course_id, stars, created_at) VALUES (?, ?, ?, ?)",
                (row["member_id"], row["course_id"], rng.choice([3, 4, 4, 5, 5, 5]), f"{row['date']} 21:00:00"),
            )
            added += 1
    cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('demo_ratings_v1', ?)", (now_iso(),))
    conn.commit()
    return added


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def now_iso():
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def init_db(seed: bool = True):
    conn = get_db()
    cur = conn.cursor()

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS studios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            studio_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            capacity INTEGER NOT NULL DEFAULT 20,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS course_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            required_qualification TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL DEFAULT 'pass123',
            role TEXT NOT NULL DEFAULT 'trainer',
            qualifications TEXT NOT NULL,
            employment_model TEXT NOT NULL CHECK (employment_model IN ('Vollzeit', 'Teilzeit')),
            weekly_hours INTEGER NOT NULL,
            max_courses_per_week INTEGER NOT NULL,
            can_travel INTEGER NOT NULL DEFAULT 1,
            home_studio_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'unavailable')),
            unavailable_reason TEXT,
            unavailable_from TEXT,
            unavailable_to TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (home_studio_id) REFERENCES studios(id)
        );

        CREATE TABLE IF NOT EXISTS availabilities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            course_type_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            start_time TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            room_id INTEGER NOT NULL,
            trainer_id INTEGER,
            absent_trainer_id INTEGER,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_replacement', 'cancelled')),
            special_event INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (course_type_id) REFERENCES course_types(id),
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            FOREIGN KEY (trainer_id) REFERENCES employees(id) ON DELETE SET NULL,
            FOREIGN KEY (absent_trainer_id) REFERENCES employees(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_employee_id INTEGER,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            channel TEXT NOT NULL DEFAULT 'Website',
            is_read INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (recipient_employee_id) REFERENCES employees(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS email_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
            to_address TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            studio_id INTEGER REFERENCES studios(id) ON DELETE SET NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            amount_net REAL NOT NULL CHECK (amount_net >= 0),
            created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS leave_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT 'Urlaub',
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            decided_at TEXT,
            decided_by INTEGER REFERENCES employees(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS membership_pauses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            start_month TEXT NOT NULL,
            months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 3),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS favorites (
            member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('course_type', 'trainer')),
            target_id INTEGER NOT NULL,
            PRIMARY KEY (member_id, kind, target_id)
        );

        CREATE TABLE IF NOT EXISTS ratings (
            member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (member_id, course_id)
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL DEFAULT 'pass123',
            phone TEXT,
            birth_date TEXT,
            address TEXT,
            home_studio_id INTEGER REFERENCES studios(id) ON DELETE SET NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_id INTEGER NOT NULL,
            course_id INTEGER NOT NULL,
            booking_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL DEFAULT 'booked',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
            FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS trial_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            studio_id INTEGER REFERENCES studios(id) ON DELETE SET NULL,
            course_type_id INTEGER REFERENCES course_types(id) ON DELETE SET NULL,
            preferred_date TEXT,
            message TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    conn.commit()

    # Migration for older local databases: keep the original sick trainer
    # visible even when the course is opened for replacement.
    add_column_if_missing(conn, "courses", "absent_trainer_id", "INTEGER")

    # Migration: studio map positions and member accounts.
    add_column_if_missing(conn, "studios", "latitude", "REAL")
    add_column_if_missing(conn, "studios", "longitude", "REAL")
    add_column_if_missing(conn, "members", "password", "TEXT NOT NULL DEFAULT 'pass123'")
    add_column_if_missing(conn, "members", "phone", "TEXT")
    add_column_if_missing(conn, "members", "birth_date", "TEXT")
    add_column_if_missing(conn, "members", "address", "TEXT")
    add_column_if_missing(conn, "members", "home_studio_id", "INTEGER REFERENCES studios(id) ON DELETE SET NULL")
    add_column_if_missing(conn, "employees", "phone", "TEXT")
    add_column_if_missing(conn, "employees", "birth_date", "TEXT")
    add_column_if_missing(conn, "employees", "address", "TEXT")
    # Migration: availability per calendar week (week_start = Monday); NULL rows are the standard week.
    add_column_if_missing(conn, "availabilities", "week_start", "TEXT")
    for emp in cur.execute("SELECT id, weekly_hours FROM employees").fetchall():
        rows = cur.execute(
            "SELECT start_time, end_time FROM availabilities WHERE employee_id = ? AND week_start IS NULL", (emp["id"],)
        ).fetchall()
        hours = sum(_minutes(r["end_time"]) - _minutes(r["start_time"]) for r in rows) / 60
        low, high = availability_bounds(emp["weekly_hours"])
        if not low <= hours <= high:
            cur.execute("DELETE FROM availabilities WHERE employee_id = ? AND week_start IS NULL", (emp["id"],))
            cur.executemany(
                "INSERT INTO availabilities (employee_id, weekday, start_time, end_time, updated_at) VALUES (?, ?, ?, ?, ?)",
                [(emp["id"], *slot, now_iso()) for slot in default_availability(emp["id"], emp["weekly_hours"])],
            )
    # Migration: membership plan, start date and a plan change waiting for the next month.
    add_column_if_missing(conn, "members", "membership_type", "TEXT NOT NULL DEFAULT 'plus'")
    add_column_if_missing(conn, "members", "member_since", "TEXT")
    add_column_if_missing(conn, "members", "pending_membership_type", "TEXT")
    add_column_if_missing(conn, "members", "pending_from", "TEXT")
    backfill_memberships(cur)
    # Migration: costs. Monthly gross salary per employee, rent and energy per studio.
    add_column_if_missing(conn, "employees", "monthly_salary", "REAL")
    add_column_if_missing(conn, "studios", "monthly_rent", "REAL")
    add_column_if_missing(conn, "studios", "monthly_energy", "REAL")
    backfill_costs(cur)
    # Migration: trial requests get a processing status (neu, kontaktiert, erledigt).
    add_column_if_missing(conn, "trial_requests", "status", "TEXT NOT NULL DEFAULT 'neu'")
    # Migration: attendance per booking (the coach checks members in; NULL = not checked in).
    conn.execute("DROP TABLE IF EXISTS checkins")
    add_column_if_missing(conn, "bookings", "attended", "INTEGER")
    # Migration: messages are addressed with "Sie"; rewrite older informal ones.
    for old, new in SIE_REWRITES:
        cur.execute("UPDATE notifications SET message = REPLACE(message, ?, ?) WHERE message LIKE ?", (old, new, f"%{old}%"))
    add_column_if_missing(conn, "notifications", "recipient_member_id", "INTEGER REFERENCES members(id) ON DELETE CASCADE")
    for studio in cur.execute("SELECT id, name FROM studios WHERE latitude IS NULL").fetchall():
        city = studio["name"].split(" - ", 1)[-1]
        if city in STUDIO_COORDS:
            cur.execute("UPDATE studios SET latitude = ?, longitude = ? WHERE id = ?", (*STUDIO_COORDS[city], studio["id"]))
    # Migration: "Fit & Aktiv Studio 01 - Krefeld Zentrum" -> "Studio Krefeld Zentrum".
    cur.execute(
        "UPDATE studios SET name = 'Studio ' || substr(name, instr(name, ' - ') + 3) "
        "WHERE name LIKE 'Fit & Aktiv Studio % - %'"
    )
    # Migration: old messages named courses by id ("Kurs #12"); use the course name and date instead.
    for note in cur.execute("SELECT id, message FROM notifications WHERE message LIKE '%Kurs #%'").fetchall():
        def course_text(match):
            row = cur.execute(
                "SELECT ct.name, c.date FROM courses c JOIN course_types ct ON ct.id = c.course_type_id WHERE c.id = ?",
                (int(match.group(1)),),
            ).fetchone()
            if not row:
                return "ein Kurs"
            y, m, d = row["date"].split("-")
            return f"{row['name']} am {d}.{m}.{y}"
        cur.execute(
            "UPDATE notifications SET message = ? WHERE id = ?",
            (re.sub(r"Kurs #(\d+)", course_text, note["message"]), note["id"]),
        )
    studio_count = cur.execute("SELECT COUNT(*) FROM studios").fetchone()[0]
    if studio_count:
        cur.execute("UPDATE members SET home_studio_id = ((id - 1) % ?) + 1 WHERE home_studio_id IS NULL", (studio_count,))
    conn.commit()

    if seed:
        cur.execute("SELECT COUNT(*) AS c FROM studios")
        if cur.fetchone()["c"] == 0:
            seed_demo_data(conn)
            backfill_memberships(cur)
            backfill_costs(cur)
            conn.commit()

    conn.close()


# Weekly availability must cover at least the contract hours. The upper value (contract + 20 %,
# 48 h for full time = the legal weekly maximum in Germany) is the most course hours a week can hold;
# once a week is planned that full, its availability cannot grow.
AVAILABILITY_HEADROOM = 1.2


def availability_bounds(weekly_hours: int) -> Tuple[int, int]:
    return int(weekly_hours), int(weekly_hours * AVAILABILITY_HEADROOM)


def default_availability(employee_id: int, weekly_hours: int) -> List[Tuple[int, str, str]]:
    """Standard week inside the allowed band: whole-hour shifts, early or late depending on the id."""
    days = min(5, max(1, -(-weekly_hours // 8)))
    hours = -(-weekly_hours // days)
    weekdays = sorted({(employee_id + 2 * k) % 5 for k in range(days)})  # spread over the week
    if employee_id % 2:
        start, end = 20 - hours, 20
    else:
        start, end = 8, 8 + hours
    return [(weekday, f"{start:02d}:00", f"{end:02d}:00") for weekday in weekdays]


def _minutes(value: str) -> int:
    hours, minutes = value.split(":")[:2]
    return int(hours) * 60 + int(minutes)


HOURLY_WAGE = 17.5  # gross €/h for trainers; above the 2026 minimum wage


def default_salary(weekly_hours: float, role: str = "trainer", employee_id: int = 0) -> float:
    """Monthly gross salary: management fixed, trainers hours x 4.33 weeks x hourly wage (rounded to 10 €).
    The wage varies by experience between 16 and 20 €/h (spread over the id for the demo)."""
    if role == "admin":
        return 4400.0
    wage = HOURLY_WAGE - 1.5 + (employee_id * 37 % 9) * 0.5
    return float(round(weekly_hours * 4.33 * wage / 10) * 10)


def backfill_costs(cur):
    """Salaries, rents and energy costs for rows that have none yet (deterministic, varied per id)."""
    # v1 gave every trainer the same wage; spread them unless someone has changed a salary by hand.
    if not cur.execute("SELECT 1 FROM app_settings WHERE key = 'salary_spread_v1'").fetchone():
        for e in cur.execute("SELECT id, weekly_hours, role, monthly_salary FROM employees").fetchall():
            flat = float(round(e["weekly_hours"] * 4.33 * HOURLY_WAGE / 10) * 10)
            if e["monthly_salary"] in (None, flat) and e["role"] != "admin":
                cur.execute("UPDATE employees SET monthly_salary = NULL WHERE id = ?", (e["id"],))
        cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('salary_spread_v1', ?)", (now_iso(),))
    for e in cur.execute("SELECT id, weekly_hours, role FROM employees WHERE monthly_salary IS NULL").fetchall():
        cur.execute(
            "UPDATE employees SET monthly_salary = ? WHERE id = ?",
            (default_salary(e["weekly_hours"], e["role"], e["id"]), e["id"]),
        )
    # v2: rents for 1,000 to 1,500 m² studios (v1 was too low for a realistic margin).
    if not cur.execute("SELECT 1 FROM app_settings WHERE key = 'rent_v2'").fetchone():
        cur.execute("UPDATE studios SET monthly_rent = NULL")
        cur.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('rent_v2', ?)", (now_iso(),))
    for st in cur.execute("SELECT id FROM studios WHERE monthly_rent IS NULL").fetchall():
        rent = 7000 + (st["id"] * 523) % 4600
        cur.execute(
            "UPDATE studios SET monthly_rent = ?, monthly_energy = ? WHERE id = ?",
            (float(round(rent / 50) * 50), float(1150 + (st["id"] * 97) % 700), st["id"]),
        )


def backfill_memberships(cur):
    """Members without a start date get one 1 to 48 months back and a plan, spread by id."""
    for m in cur.execute("SELECT id FROM members WHERE member_since IS NULL").fetchall():
        start = date.today().replace(day=1)
        for _ in range((m["id"] * 7) % 48 + 1):
            start = (start - timedelta(days=1)).replace(day=1)
        cur.execute(
            "UPDATE members SET member_since = ?, membership_type = ? WHERE id = ?",
            (start.isoformat(), MEMBERSHIP_TYPES[m["id"] % len(MEMBERSHIP_TYPES)], m["id"]),
        )


def hash_plaintext_passwords(conn):
    """Replaces stored plain-text passwords (old databases, demo seeds) with salted scrypt hashes."""
    for table in ("members", "employees"):
        plain = conn.execute(
            f"SELECT DISTINCT password FROM {table} WHERE password NOT LIKE 'scrypt:%' AND password NOT LIKE 'pbkdf2:%'"
        ).fetchall()
        # ponytail: one hash per distinct old password (all demo rows share 'pass123', 25k rows x 60 ms
        # would block startup), so equal old passwords share a salt; new and changed passwords get their own.
        for (password,) in plain:
            conn.execute(f"UPDATE {table} SET password = ? WHERE password = ?", (generate_password_hash(password), password))
    conn.commit()


def add_column_if_missing(conn, table: str, column: str, definition: str):
    columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def seed_demo_data(conn):
    cur = conn.cursor()
    ts = now_iso()

    for idx, city in enumerate(STUDIO_CITIES, start=1):
        lat, lng = STUDIO_COORDS[city]
        cur.execute(
            "INSERT INTO studios (name, address, latitude, longitude, updated_at) VALUES (?, ?, ?, ?, ?)",
            (f"Studio {city}", f"Fitnessstraße {idx}, {city}", lat, lng, ts),
        )
        studio_id = cur.lastrowid
        cur.execute("INSERT INTO rooms (studio_id, name, capacity, updated_at) VALUES (?, ?, ?, ?)", (studio_id, "Kursraum A", 24, ts))
        cur.execute("INSERT INTO rooms (studio_id, name, capacity, updated_at) VALUES (?, ?, ?, ?)", (studio_id, "Kursraum B", 18, ts))

    for name, qualification in COURSE_TYPES:
        cur.execute(
            "INSERT INTO course_types (name, required_qualification, updated_at) VALUES (?, ?, ?)",
            (name, qualification, ts),
        )

    employee_no = 1
    qualification_names = [q[1] for q in COURSE_TYPES]
    for studio_id in range(1, 23):
        for local_idx in range(5):
            first = FIRST_NAMES[(employee_no - 1) % len(FIRST_NAMES)]
            last = LAST_NAMES[(employee_no + studio_id + local_idx) % len(LAST_NAMES)]
            name = f"{first} {last}"
            email = login_email_for_name(name)
            role = "admin" if employee_no == 1 else "trainer"
            employment_model = "Vollzeit" if local_idx < 2 else "Teilzeit"
            weekly_hours = 40 if employment_model == "Vollzeit" else 10
            max_courses = 20 if employment_model == "Vollzeit" else 6
            can_travel = 1 if local_idx in (0, 2, 4) else 0
            q1 = qualification_names[(employee_no + local_idx) % len(qualification_names)]
            q2 = qualification_names[(employee_no + local_idx + 2) % len(qualification_names)]
            qualifications = f"{q1},{q2}"
            cur.execute(
                """
                INSERT INTO employees
                (name, email, password, role, qualifications, employment_model, weekly_hours, max_courses_per_week,
                 can_travel, home_studio_id, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
                """,
                (
                    name,
                    email,
                    "pass123",
                    role,
                    qualifications,
                    employment_model,
                    weekly_hours,
                    max_courses,
                    can_travel,
                    studio_id,
                    ts,
                ),
            )
            emp_id = cur.lastrowid
            for weekday, start, end in default_availability(emp_id, weekly_hours):
                cur.execute(
                    "INSERT INTO availabilities (employee_id, weekday, start_time, end_time, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (emp_id, weekday, start, end, ts),
                )
            employee_no += 1

    # Seed courses for the next two working weeks.
    cur.execute("SELECT id, studio_id FROM rooms WHERE name = 'Kursraum A' ORDER BY id")
    rooms = cur.fetchall()
    cur.execute("SELECT id, name FROM course_types ORDER BY id")
    course_types = cur.fetchall()

    today = date.today()
    days = []
    d = today
    while len(days) < 10:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)

    time_slots = ["08:00", "10:00", "12:00", "17:00", "19:00"]
    for day_index, day in enumerate(days):
        for studio_id in range(1, 23):
            room = rooms[studio_id - 1]
            for slot_index in range(2):
                course_type_id = course_types[(studio_id + day_index + slot_index) % len(course_types)]["id"]
                start_time = time_slots[(day_index + slot_index) % len(time_slots)]
                trainer_id = ((studio_id - 1) * 5) + ((day_index + slot_index) % 5) + 1
                cur.execute(
                    """
                    INSERT INTO courses
                    (course_type_id, date, start_time, duration_minutes, room_id, trainer_id, absent_trainer_id, status, special_event, updated_at)
                    VALUES (?, ?, ?, 60, ?, ?, NULL, 'active', 0, ?)
                    """,
                    (course_type_id, day.isoformat(), start_time, room["id"], trainer_id, ts),
                )

    # Demo members, spread over the studios.
    for i in range(1, 31):
        cur.execute(
            "INSERT INTO members (name, email, password, home_studio_id, updated_at) VALUES (?, ?, ?, ?, ?)",
            (f"Mitglied {i:02d}", f"mitglied{i:02d}@example.local", "pass123", ((i - 1) % 22) + 1, ts),
        )

    cur.execute(
        "INSERT INTO notifications (recipient_employee_id, message, channel, created_at) VALUES (?, ?, ?, ?)",
        (1, "Willkommen! Die lokale Fit & Aktiv Demo-Datenbank wurde mit 22 Studios und 110 Mitarbeitern erstellt.", "Website", ts),
    )

    conn.commit()


if __name__ == "__main__":
    init_db(seed=True)
    print(f"Database ready: {DB_PATH}")
