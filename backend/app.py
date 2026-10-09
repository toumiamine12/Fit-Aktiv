from __future__ import annotations

import os
import random
import secrets
import base64
import hashlib
import hmac
import time
from functools import wraps
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, jsonify, request, g
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

from database import (
    EXPENSE_CATEGORIES,
    default_salary,
    DB_PATH,
    availability_bounds,
    default_availability,
    get_db,
    hash_plaintext_passwords,
    init_db,
    now_iso,
    MEMBERSHIP_TYPES,
    seed_demo_members,
    seed_demo_attendance,
    seed_demo_cancellations,
    seed_demo_expenses,
    seed_demo_member_base,
    seed_demo_trials,
    seed_demo_volume,
    seed_demo_ratings,
)

app = Flask(__name__)
CORS(app)
if os.environ.get("FITAKTIV_BEHIND_PROXY") == "1":
    # Behind nginx (Docker): use the client address from X-Forwarded-For, so the login lockout stays per client.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

PRODUCTION = os.environ.get("FITAKTIV_ENV") == "production"
AUTH_SECRET = os.environ.get("FITAKTIV_AUTH_SECRET") or ("" if PRODUCTION else "fit-aktiv-local-dev-secret")
if not AUTH_SECRET:
    raise SystemExit("FITAKTIV_AUTH_SECRET must be set when FITAKTIV_ENV=production.")


STAFF_ROLES = ["admin", "trainer"]


TOKEN_TTL_SECONDS = 7 * 24 * 3600
MIN_PASSWORD_LENGTH = 8
RESET_TTL_MINUTES = 60
# Base of the links in e-mails; never taken from the request, so a forged Host header cannot redirect them.
PUBLIC_URL = os.environ.get("FITAKTIV_PUBLIC_URL", "http://localhost:5173").rstrip("/")


def make_token(user_id: int, kind: str = "employee") -> str:
    # "m:<id>" marks a member account, plain ids are employees; "|<unix time>" is the expiry.
    subject = f"m:{user_id}" if kind == "member" else str(user_id)
    payload = f"{subject}|{int(time.time()) + TOKEN_TTL_SECONDS}".encode("utf-8")
    body = base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")
    sig = hmac.new(AUTH_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def current_user_from_request(conn=None):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header.replace("Bearer ", "", 1).strip()
    if "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    expected = hmac.new(AUTH_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        padded = body + "=" * (-len(body) % 4)
        subject, expires = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8").split("|")
        if int(expires) < time.time():
            return None
        is_member = subject.startswith("m:")
        user_id = int(subject[2:] if is_member else subject)
    except Exception:
        return None
    close_conn = False
    if conn is None:
        conn = get_db()
        close_conn = True
    table = "members" if is_member else "employees"
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (user_id,)).fetchone()
    if close_conn:
        conn.close()
    if not row:
        return None
    user = without_password(row)
    if is_member:
        user["role"] = "member"
    return user


def is_staff(user: Optional[Dict[str, Any]]) -> bool:
    return bool(user) and user.get("role") in STAFF_ROLES


def require_auth(roles=None):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user_from_request()
            if not user:
                return json_error("Bitte zuerst einloggen.", 401)
            allowed = roles or []
            if allowed and user.get("role") not in allowed:
                return json_error("Keine Berechtigung für diese Aktion.", 403)
            g.current_user = user
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def password_error(password: str) -> Optional[str]:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Das Passwort muss mindestens {MIN_PASSWORD_LENGTH} Zeichen lang sein."
    return None


# ponytail: in-memory and per process, resets on restart; move to the DB or Redis when running several workers.
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_SECONDS = 15 * 60
login_failures: Dict[Tuple[str, str], List[float]] = {}


def without_password(row: Dict[str, Any]) -> Dict[str, Any]:
    clean = dict(row)
    clean.pop("password", None)
    return clean


def rows_to_list(rows) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]


def json_error(message: str, status: int = 400, details: Optional[Any] = None):
    payload = {"ok": False, "error": message}
    if details is not None:
        payload["details"] = details
    return jsonify(payload), status


def parse_time_to_minutes(value: str) -> int:
    hours, minutes = value.split(":")[:2]
    return int(hours) * 60 + int(minutes)


def course_interval(course: Dict[str, Any]) -> Tuple[int, int]:
    start = parse_time_to_minutes(course["start_time"])
    return start, start + int(course.get("duration_minutes") or 60)


def get_studio_id_for_room(conn, room_id: int) -> Optional[int]:
    row = conn.execute("SELECT studio_id FROM rooms WHERE id = ?", (room_id,)).fetchone()
    return row["studio_id"] if row else None


def get_course_full(conn, course_id: int) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT c.*, ct.name AS course_type_name, ct.required_qualification,
               r.name AS room_name, r.studio_id, s.name AS studio_name,
               e.name AS trainer_name, e.email AS trainer_email,
               ae.name AS absent_trainer_name, ae.email AS absent_trainer_email
        FROM courses c
        JOIN course_types ct ON ct.id = c.course_type_id
        JOIN rooms r ON r.id = c.room_id
        JOIN studios s ON s.id = r.studio_id
        LEFT JOIN employees e ON e.id = c.trainer_id
        LEFT JOIN employees ae ON ae.id = c.absent_trainer_id
        WHERE c.id = ?
        """,
        (course_id,),
    ).fetchone()
    return dict(row) if row else None


def week_bounds(date_text: str) -> Tuple[str, str]:
    d = date.fromisoformat(date_text)
    monday = d - timedelta(days=d.weekday())
    sunday = monday + timedelta(days=6)
    return monday.isoformat(), sunday.isoformat()


def employee_has_qualification(employee: Dict[str, Any], required: str) -> bool:
    qualifications = [q.strip().lower() for q in (employee.get("qualifications") or "").split(",")]
    return required.strip().lower() in qualifications


def employee_is_absent(conn, employee_id: int, course_date: str) -> bool:
    row = conn.execute(
        """
        SELECT id FROM absences
        WHERE employee_id = ? AND date(?) BETWEEN date(start_date) AND date(end_date)
        LIMIT 1
        """,
        (employee_id, course_date),
    ).fetchone()
    if row:
        return True
    emp = conn.execute("SELECT status, unavailable_from, unavailable_to FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if not emp:
        return True
    if emp["status"] != "unavailable":
        return False
    if emp["unavailable_from"] and emp["unavailable_to"]:
        return date.fromisoformat(emp["unavailable_from"]) <= date.fromisoformat(course_date) <= date.fromisoformat(emp["unavailable_to"])
    return True


def week_availability(conn, employee_id: int, monday: str) -> List[Dict[str, Any]]:
    """Slots for one calendar week: the week's own entries if it was edited, otherwise the standard week."""
    rows = conn.execute(
        "SELECT weekday, start_time, end_time FROM availabilities WHERE employee_id = ? AND week_start = ?",
        (employee_id, monday),
    ).fetchall()
    if not rows:
        rows = conn.execute(
            "SELECT weekday, start_time, end_time FROM availabilities WHERE employee_id = ? AND week_start IS NULL",
            (employee_id,),
        ).fetchall()
    return rows_to_list(rows)


def slots_cover(slots, weekday: int, start_min: int, end_min: int) -> bool:
    return any(
        s["weekday"] == weekday
        and parse_time_to_minutes(s["start_time"]) <= start_min
        and end_min <= parse_time_to_minutes(s["end_time"])
        for s in slots
    )


def employee_available_at(conn, employee_id: int, course_date: str, start_time: str, duration_minutes: int) -> bool:
    d = date.fromisoformat(course_date)
    start_min = parse_time_to_minutes(start_time)
    end_min = start_min + int(duration_minutes or 60)
    return slots_cover(week_availability(conn, employee_id, week_bounds(course_date)[0]), d.weekday(), start_min, end_min)


def weekly_course_count(conn, employee_id: int, course_date: str, exclude_course_id: Optional[int] = None) -> int:
    monday, sunday = week_bounds(course_date)
    sql = """
        SELECT COUNT(*) AS c FROM courses
        WHERE trainer_id = ? AND status IN ('active', 'needs_replacement')
        AND date(date) BETWEEN date(?) AND date(?)
    """
    params: List[Any] = [employee_id, monday, sunday]
    if exclude_course_id:
        sql += " AND id != ?"
        params.append(exclude_course_id)
    return conn.execute(sql, params).fetchone()["c"]


def month_bounds(date_text: str) -> Tuple[str, str]:
    d = date.fromisoformat(date_text)
    first_day = d.replace(day=1)
    if first_day.month == 12:
        next_month = date(first_day.year + 1, 1, 1)
    else:
        next_month = date(first_day.year, first_day.month + 1, 1)
    return first_day.isoformat(), next_month.isoformat()


def monthly_course_count(conn, employee_id: int, course_date: str, exclude_course_id: Optional[int] = None) -> int:
    month_start, next_month = month_bounds(course_date)
    sql = """
        SELECT COUNT(*) AS c FROM courses
        WHERE trainer_id = ? AND status IN ('active', 'needs_replacement')
        AND date(date) >= date(?) AND date(date) < date(?)
    """
    params: List[Any] = [employee_id, month_start, next_month]
    if exclude_course_id:
        sql += " AND id != ?"
        params.append(exclude_course_id)
    return conn.execute(sql, params).fetchone()["c"]


def employee_monthly_course_limit(employee: Dict[str, Any]) -> int:
    model = (employee.get("employment_model") or "").strip().lower()
    if model.startswith("voll"):
        return 20
    if model.startswith("teil"):
        return 10
    return int(employee.get("max_courses_per_week") or 0) * 4


def employee_has_time_conflict(conn, employee_id: int, new_course: Dict[str, Any], exclude_course_id: Optional[int] = None) -> Tuple[bool, Optional[str]]:
    new_start, new_end = course_interval(new_course)
    new_studio_id = new_course.get("studio_id") or get_studio_id_for_room(conn, int(new_course["room_id"]))

    sql = """
        SELECT c.*, r.studio_id, ct.name AS course_type_name, s.name AS studio_name
        FROM courses c
        JOIN rooms r ON r.id = c.room_id
        JOIN studios s ON s.id = r.studio_id
        JOIN course_types ct ON ct.id = c.course_type_id
        WHERE c.trainer_id = ? AND c.date = ? AND c.status IN ('active', 'needs_replacement')
    """
    params: List[Any] = [employee_id, new_course["date"]]
    if exclude_course_id:
        sql += " AND c.id != ?"
        params.append(exclude_course_id)
    for existing in conn.execute(sql, params).fetchall():
        ex = dict(existing)
        ex_start, ex_end = course_interval(ex)
        if ex["studio_id"] == new_studio_id:
            buffer_start, buffer_end = ex_start, ex_end
        else:
            buffer_start, buffer_end = ex_start - 60, ex_end + 60
        # half-open intervals: [start, end). Exact boundary without travel conflict is allowed.
        if new_start < buffer_end and new_end > buffer_start:
            reason = (
                f"Zeitkonflikt mit {ex['course_type_name']} am {ex['date']} "
                f"um {ex['start_time']} in {ex['studio_name']}"
            )
            return True, reason
    return False, None


def validate_trainer_for_course(conn, trainer_id: int, course: Dict[str, Any], exclude_course_id: Optional[int] = None) -> Tuple[bool, List[str]]:
    reasons: List[str] = []
    employee = conn.execute("SELECT * FROM employees WHERE id = ?", (trainer_id,)).fetchone()
    if not employee:
        return False, ["Trainer existiert nicht."]
    emp = dict(employee)

    required = course.get("required_qualification")
    if required is None:
        course_type = conn.execute("SELECT required_qualification FROM course_types WHERE id = ?", (course["course_type_id"],)).fetchone()
        required = course_type["required_qualification"] if course_type else ""
    if required and not employee_has_qualification(emp, required):
        reasons.append(f"Qualifikation fehlt: {required}.")

    if employee_is_absent(conn, trainer_id, course["date"]):
        reasons.append("Trainer ist in diesem Zeitraum nicht verfügbar / krankgemeldet.")

    if not employee_available_at(conn, trainer_id, course["date"], course["start_time"], int(course.get("duration_minutes") or 60)):
        reasons.append("Trainer hat zu diesem Zeitpunkt keine hinterlegte Verfügbarkeit.")

    count = weekly_course_count(conn, trainer_id, course["date"], exclude_course_id=exclude_course_id)
    if count >= int(emp["max_courses_per_week"]):
        reasons.append(f"Wochenlimit erreicht ({count}/{emp['max_courses_per_week']} Kurse).")

    month_count = monthly_course_count(conn, trainer_id, course["date"], exclude_course_id=exclude_course_id)
    month_limit = employee_monthly_course_limit(emp)
    if month_limit and month_count >= month_limit:
        reasons.append(f"Monatslimit erreicht ({month_count}/{month_limit} Kurse für {emp['employment_model']}).")

    has_conflict, conflict_reason = employee_has_time_conflict(conn, trainer_id, course, exclude_course_id=exclude_course_id)
    if has_conflict and conflict_reason:
        reasons.append(conflict_reason)

    # Travel rule: if employee cannot travel, only allow courses in home studio.
    studio_id = course.get("studio_id") or get_studio_id_for_room(conn, int(course["room_id"]))
    if not int(emp.get("can_travel") or 0) and int(emp["home_studio_id"]) != int(studio_id):
        reasons.append("Trainer darf nicht zwischen Studios pendeln.")

    return len(reasons) == 0, reasons


def replacement_candidates(conn, course_id: int, limit: int = 30) -> List[Dict[str, Any]]:
    course = get_course_full(conn, course_id)
    if not course:
        return []
    old_trainer = course.get("trainer_id")
    employees = conn.execute("SELECT * FROM employees ORDER BY home_studio_id, name").fetchall()
    candidates: List[Dict[str, Any]] = []
    for row in employees:
        emp = dict(row)
        if old_trainer and int(emp["id"]) == int(old_trainer):
            continue
        ok, reasons = validate_trainer_for_course(conn, int(emp["id"]), course, exclude_course_id=course_id)
        if ok:
            same_studio = int(emp["home_studio_id"]) == int(course["studio_id"])
            score = 0
            score += 100 if same_studio else 30
            score += 10 if int(emp["can_travel"]) else 0
            score -= weekly_course_count(conn, int(emp["id"]), course["date"], exclude_course_id=course_id)
            candidates.append(
                {
                    "id": emp["id"],
                    "name": emp["name"],
                    "email": emp["email"],
                    "qualifications": emp["qualifications"],
                    "employment_model": emp["employment_model"],
                    "home_studio_id": emp["home_studio_id"],
                    "same_studio": same_studio,
                    "score": score,
                }
            )
    return sorted(candidates, key=lambda c: c["score"], reverse=True)[:limit]


def create_notification(conn, recipient_employee_id: Optional[int], message: str, channel: str = "Website"):
    conn.execute(
        "INSERT INTO notifications (recipient_employee_id, message, channel, created_at) VALUES (?, ?, ?, ?)",
        (recipient_employee_id, message, channel, now_iso()),
    )


def send_email(conn, member_id: int, subject: str, message: str):
    """Local stand-in for an email service: the mail is written to the outbox table, which admins can read."""
    member = conn.execute("SELECT name, email FROM members WHERE id = ?", (member_id,)).fetchone()
    if not member:
        return
    body = f"Guten Tag {member['name']},\n\n{message}\n\nMit sportlichen Grüßen\nIhr Team von Fit & Aktiv"
    conn.execute(
        "INSERT INTO email_outbox (member_id, to_address, subject, body, created_at) VALUES (?, ?, ?, ?, ?)",
        (member_id, member["email"], subject, body, now_iso()),
    )


def notify_booked_members(
    conn, course_id: int, message: str, include_waiting: bool = False, email_subject: Optional[str] = None
):
    statuses = "('booked', 'waiting')" if include_waiting else "('booked')"
    recipients = [
        r["member_id"]
        for r in conn.execute(f"SELECT member_id FROM bookings WHERE course_id = ? AND status IN {statuses}", (course_id,))
    ]
    for member_id in recipients:
        conn.execute(
            "INSERT INTO notifications (recipient_member_id, message, channel, created_at) VALUES (?, ?, 'Website', ?)",
            (member_id, message, now_iso()),
        )
        if email_subject:
            send_email(conn, member_id, email_subject, message)


def course_label(course: Dict[str, Any]) -> str:
    day = datetime.strptime(course["date"], "%Y-%m-%d").strftime("%d.%m.%Y")
    return f"{course['course_type_name']} am {day} um {course['start_time']} Uhr ({course['studio_name']})"


def get_revision() -> Dict[str, Any]:
    if not DB_PATH.exists():
        return {"db_mtime": 0, "updated_at": None}
    mtime = os.path.getmtime(DB_PATH)
    latest = None
    try:
        conn = get_db()
        parts = []
        for table in ["studios", "rooms", "employees", "course_types", "courses", "availabilities", "notifications", "absences"]:
            row = conn.execute(f"SELECT MAX(updated_at) AS m FROM {table}" if table not in ["notifications", "absences"] else f"SELECT MAX(created_at) AS m FROM {table}").fetchone()
            if row and row["m"]:
                parts.append(row["m"])
        latest = max(parts) if parts else None
        conn.close()
    except Exception:
        latest = None
    # The date is part of it so open pages reload once after midnight (today's courses, absences).
    return {"db_mtime": mtime, "updated_at": latest, "date": date.today().isoformat()}


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "message": "Fit & Aktiv Backend läuft", "database": str(DB_PATH), "revision": get_revision()})


@app.route("/api/revision")
def revision():
    return jsonify({"ok": True, "revision": get_revision()})


def sync_absence_status(conn):
    """Trainers are 'unavailable' exactly while an absence covers today (planned leave starts and ends by itself)."""
    today = date.today().isoformat()
    conn.execute(
        """
        UPDATE employees SET status = 'unavailable',
            unavailable_reason = (SELECT reason FROM absences a WHERE a.employee_id = employees.id AND date(?) BETWEEN a.start_date AND a.end_date ORDER BY a.id DESC LIMIT 1),
            unavailable_from = (SELECT start_date FROM absences a WHERE a.employee_id = employees.id AND date(?) BETWEEN a.start_date AND a.end_date ORDER BY a.id DESC LIMIT 1),
            unavailable_to = (SELECT end_date FROM absences a WHERE a.employee_id = employees.id AND date(?) BETWEEN a.start_date AND a.end_date ORDER BY a.id DESC LIMIT 1)
        WHERE status = 'available'
          AND EXISTS (SELECT 1 FROM absences a WHERE a.employee_id = employees.id AND date(?) BETWEEN a.start_date AND a.end_date)
        """,
        (today, today, today, today),
    )
    conn.execute(
        """
        UPDATE employees SET status = 'available', unavailable_reason = NULL, unavailable_from = NULL, unavailable_to = NULL
        WHERE status = 'unavailable' AND unavailable_to IS NOT NULL AND date(unavailable_to) < date(?)
          AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.employee_id = employees.id AND date(?) BETWEEN a.start_date AND a.end_date)
        """,
        (today, today),
    )


@app.route("/api/data")
def data():
    conn = get_db()
    sync_absence_status(conn)
    conn.commit()
    current_user = current_user_from_request(conn) or {}
    staff = is_staff(current_user)
    member = current_user.get("role") == "member"
    studios = rows_to_list(conn.execute("SELECT * FROM studios ORDER BY id").fetchall())
    rooms = rows_to_list(
        conn.execute(
            """
            SELECT r.*, s.name AS studio_name
            FROM rooms r JOIN studios s ON s.id = r.studio_id
            ORDER BY r.studio_id, r.name
            """
        ).fetchall()
    )
    employees_raw = rows_to_list(
        conn.execute(
            """
            SELECT e.*, s.name AS home_studio_name,
                   (SELECT COUNT(*) FROM courses c WHERE c.trainer_id = e.id AND c.status IN ('active','needs_replacement')) AS assigned_courses
            FROM employees e
            JOIN studios s ON s.id = e.home_studio_id
            ORDER BY e.home_studio_id, e.name
            """
        ).fetchall()
    )
    employees = [without_password(e) for e in employees_raw]
    for e in employees:
        e["min_available_hours"], e["max_available_hours"] = availability_bounds(e["weekly_hours"])
        if current_user.get("role") != "admin":
            e.pop("monthly_salary", None)  # salaries are for the management only
    course_types = rows_to_list(conn.execute("SELECT * FROM course_types ORDER BY name").fetchall())
    courses = rows_to_list(
        conn.execute(
            """
            SELECT c.*, ct.name AS course_type_name, ct.required_qualification,
                   r.name AS room_name, r.capacity, r.studio_id, s.name AS studio_name,
                   e.name AS trainer_name, e.email AS trainer_email,
                   ae.name AS absent_trainer_name, ae.email AS absent_trainer_email,
                   COALESCE(b.booked, 0) AS booked_count, COALESCE(b.waiting, 0) AS waiting_count,
                   rt.avg_rating, COALESCE(rt.rating_count, 0) AS rating_count
            FROM courses c
            JOIN course_types ct ON ct.id = c.course_type_id
            JOIN rooms r ON r.id = c.room_id
            JOIN studios s ON s.id = r.studio_id
            LEFT JOIN employees e ON e.id = c.trainer_id
            LEFT JOIN employees ae ON ae.id = c.absent_trainer_id
            LEFT JOIN (
                SELECT course_id, SUM(status = 'booked') AS booked, SUM(status = 'waiting') AS waiting
                FROM bookings WHERE status IN ('booked', 'waiting') GROUP BY course_id
            ) b ON b.course_id = c.id
            LEFT JOIN (
                SELECT course_id, ROUND(AVG(stars), 2) AS avg_rating, COUNT(*) AS rating_count
                FROM ratings GROUP BY course_id
            ) rt ON rt.course_id = c.id
            ORDER BY c.date, c.start_time, s.name
            """
        ).fetchall()
    )
    availabilities = rows_to_list(conn.execute("SELECT * FROM availabilities ORDER BY employee_id, weekday").fetchall())
    if not staff:
        for course in courses:
            course.pop("trainer_email", None)
            course.pop("absent_trainer_email", None)

    for course in courses:
        course["is_absent_course"] = bool(
            staff
            and course.get("absent_trainer_id")
            and int(course["absent_trainer_id"]) == int(current_user["id"])
        )

    if current_user.get("role") == "admin":
        notifications = rows_to_list(
            conn.execute(
                """
                SELECT n.*, e.name AS recipient_name
                FROM notifications n
                LEFT JOIN employees e ON e.id = n.recipient_employee_id
                WHERE n.recipient_member_id IS NULL
                ORDER BY n.created_at DESC, n.id DESC
                LIMIT 100
                """
            ).fetchall()
        )
    elif staff:
        notifications = rows_to_list(
            conn.execute(
                """
                SELECT n.*, e.name AS recipient_name
                FROM notifications n
                LEFT JOIN employees e ON e.id = n.recipient_employee_id
                WHERE n.recipient_employee_id = ?
                ORDER BY n.created_at DESC, n.id DESC
                LIMIT 100
                """,
                (current_user.get("id"),),
            ).fetchall()
        )
    elif member:
        notifications = rows_to_list(
            conn.execute(
                """
                SELECT * FROM notifications WHERE recipient_member_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 50
                """,
                (current_user["id"],),
            ).fetchall()
        )
    else:
        notifications = []

    leave_requests: List[Dict[str, Any]] = []
    if staff:
        leave_requests = rows_to_list(
            conn.execute(
                f"""
                SELECT l.*, e.name AS employee_name, s.name AS studio_name
                FROM leave_requests l JOIN employees e ON e.id = l.employee_id JOIN studios s ON s.id = e.home_studio_id
                {"" if current_user.get("role") == "admin" else "WHERE l.employee_id = ?"}
                ORDER BY l.status = 'pending' DESC, l.start_date DESC LIMIT 200
                """,
                () if current_user.get("role") == "admin" else (current_user["id"],),
            ).fetchall()
        )

    me = None
    my_bookings: List[Dict[str, Any]] = []
    if member:
        apply_due_membership_change(conn, current_user["id"])
        conn.commit()
        me = without_password(
            conn.execute(
                """
                SELECT m.*, s.name AS home_studio_name
                FROM members m LEFT JOIN studios s ON s.id = m.home_studio_id
                WHERE m.id = ?
                """,
                (current_user["id"],),
            ).fetchone()
        )
        my_bookings = rows_to_list(
            conn.execute(
                """
                SELECT b.id, b.course_id, b.booking_date, b.status,
                       CASE WHEN b.status = 'waiting' THEN (
                           SELECT COUNT(*) FROM bookings w
                           WHERE w.course_id = b.course_id AND w.status = 'waiting' AND w.id <= b.id
                       ) END AS position
                FROM bookings b WHERE b.member_id = ? AND b.status IN ('booked', 'waiting')
                """,
                (current_user["id"],),
            ).fetchall()
        )
        me["pauses"] = rows_to_list(
            conn.execute(
                "SELECT id, start_month, months FROM membership_pauses WHERE member_id = ? ORDER BY start_month",
                (current_user["id"],),
            ).fetchall()
        )
        me["paused_now"] = member_paused_on(conn, current_user["id"], date.today())
        me["favorites"] = rows_to_list(
            conn.execute("SELECT kind, target_id FROM favorites WHERE member_id = ?", (current_user["id"],)).fetchall()
        )
        me["ratings"] = rows_to_list(
            conn.execute("SELECT course_id, stars FROM ratings WHERE member_id = ?", (current_user["id"],)).fetchall()
        )

    today = date.today().isoformat()
    monday, sunday = week_bounds(today)
    weekly_counts = [] if not staff else rows_to_list(
        conn.execute(
            """
            SELECT e.id AS employee_id, e.name, e.home_studio_id, s.name AS studio_name,
                   COUNT(c.id) AS sessions_this_week
            FROM employees e
            JOIN studios s ON s.id = e.home_studio_id
            LEFT JOIN courses c ON c.trainer_id = e.id
                AND c.status IN ('active','needs_replacement')
                AND date(c.date) BETWEEN date(?) AND date(?)
            GROUP BY e.id
            ORDER BY sessions_this_week DESC, e.name
            """,
            (monday, sunday),
        ).fetchall()
    )

    stats = {
        "studios": len(studios),
        "rooms": len(rooms),
        "employees": len(employees),
        "courses": len(courses),
        "active_courses": sum(1 for c in courses if c["status"] == "active"),
        "needs_replacement": sum(1 for c in courses if c["status"] == "needs_replacement"),
        "cancelled_courses": sum(1 for c in courses if c["status"] == "cancelled"),
        "unavailable_employees": sum(1 for e in employees if e["status"] == "unavailable"),
    }
    conn.close()
    return jsonify(
        {
            "ok": True,
            "revision": get_revision(),
            "stats": stats,
            "studios": studios,
            "rooms": rooms,
            "employees": employees if staff else [],
            "course_types": course_types,
            "courses": courses,
            "availabilities": availabilities if staff else [],
            "notifications": notifications,
            "weekly_counts": weekly_counts,
            "me": me,
            "my_bookings": my_bookings,
            "cancel_deadline_hours": CANCEL_DEADLINE_HOURS,
            "memberships": MEMBERSHIPS,
            "max_pause_months": MAX_PAUSE_MONTHS_PER_YEAR,
            "basic_courses_per_month": BASIC_COURSES_PER_MONTH,
            "leave_requests": leave_requests,
        }
    )


@app.route("/api/login", methods=["POST"])
def login():
    payload = request.get_json(force=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    kind = "member" if payload.get("account_type") == "member" else "employee"
    table = "members" if kind == "member" else "employees"
    key = (request.remote_addr or "", email)
    now = time.time()
    recent = [t for t in login_failures.get(key, []) if now - t < LOGIN_LOCK_SECONDS]
    if len(recent) >= LOGIN_MAX_FAILURES:
        login_failures[key] = recent
        return json_error("Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.", 429)
    conn = get_db()
    row = conn.execute(f"SELECT * FROM {table} WHERE lower(email) = ?", (email,)).fetchone()
    conn.close()
    if not row or not check_password_hash(row["password"], password):
        login_failures[key] = recent + [now]
        return json_error("Login fehlgeschlagen. Prüfe E-Mail und Passwort.", 401)
    login_failures.pop(key, None)
    user = without_password(row)
    if kind == "member":
        user["role"] = "member"
    return jsonify({"ok": True, "user": user, "token": make_token(user["id"], kind)})


@app.route("/api/password-reset", methods=["POST"])
def request_password_reset():
    """Mails a one-time link (valid for an hour). The answer is the same whether the account exists or not."""
    p = request.get_json(force=True) or {}
    email = (p.get("email") or "").strip().lower()
    kind = "member" if p.get("account_type") == "member" else "employee"
    table = "members" if kind == "member" else "employees"
    conn = get_db()
    row = conn.execute(f"SELECT id, name, email FROM {table} WHERE lower(email) = ?", (email,)).fetchone()
    if row:
        token = secrets.token_urlsafe(32)
        expires = (datetime.now() + timedelta(minutes=RESET_TTL_MINUTES)).isoformat(timespec="seconds")
        conn.execute("DELETE FROM password_resets WHERE account_type = ? AND account_id = ?", (kind, row["id"]))
        conn.execute(
            "INSERT INTO password_resets (account_type, account_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
            (kind, row["id"], hashlib.sha256(token.encode()).hexdigest(), expires),
        )
        body = (
            f"Guten Tag {row['name']},\n\nüber diesen Link können Sie ein neues Passwort festlegen "
            f"(gültig für {RESET_TTL_MINUTES} Minuten):\n{PUBLIC_URL}/?reset={token}\n\n"
            "Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.\n\n"
            "Mit sportlichen Grüßen\nIhr Team von Fit & Aktiv"
        )
        conn.execute(
            "INSERT INTO email_outbox (member_id, to_address, subject, body, created_at) VALUES (?, ?, ?, ?, ?)",
            (row["id"] if kind == "member" else None, row["email"], "Passwort zurücksetzen", body, now_iso()),
        )
        conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/password-reset/confirm", methods=["POST"])
def confirm_password_reset():
    p = request.get_json(force=True) or {}
    password = p.get("password") or ""
    token_hash = hashlib.sha256((p.get("token") or "").encode()).hexdigest()
    conn = get_db()
    reset = conn.execute(
        "SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?",
        (token_hash, datetime.now().isoformat(timespec="seconds")),
    ).fetchone()
    if not reset:
        conn.close()
        return json_error("Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.", 400)
    if password_error(password):
        conn.close()
        return json_error(password_error(password))
    table = "members" if reset["account_type"] == "member" else "employees"
    conn.execute(
        f"UPDATE {table} SET password = ?, updated_at = ? WHERE id = ?",
        (generate_password_hash(password), now_iso(), reset["account_id"]),
    )
    conn.execute("DELETE FROM password_resets WHERE id = ?", (reset["id"],))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


MEMBER_PROFILE_FIELDS = ["name", "phone", "birth_date", "address", "home_studio_id"]
# Staff may only change personal data; work data (model, qualifications, status) stays with the admin.
EMPLOYEE_PROFILE_FIELDS = ["name", "phone", "birth_date", "address"]


@app.route("/api/members/register", methods=["POST"])
def register_member():
    p = request.get_json(force=True) or {}
    name = (p.get("name") or "").strip()
    email = (p.get("email") or "").strip().lower()
    password = p.get("password") or ""
    missing = [k for k, v in {"name": name, "email": email, "password": password, "home_studio_id": p.get("home_studio_id")}.items() if not v]
    if missing:
        return json_error("Pflichtfelder fehlen.", details=missing)
    if "@" not in email:
        return json_error("Bitte eine gültige E-Mail-Adresse eingeben.")
    if password_error(password):
        return json_error(password_error(password))
    conn = get_db()
    if conn.execute("SELECT 1 FROM members WHERE lower(email) = ?", (email,)).fetchone():
        conn.close()
        return json_error("Mit dieser E-Mail gibt es schon ein Konto. Bitte melden Sie sich stattdessen an.", 409)
    if not conn.execute("SELECT 1 FROM studios WHERE id = ?", (int(p["home_studio_id"]),)).fetchone():
        conn.close()
        return json_error("Studio nicht gefunden.")
    cur = conn.execute(
        """
        INSERT INTO members (name, email, password, phone, birth_date, address, home_studio_id,
                             membership_type, member_since, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (name, email, generate_password_hash(password), p.get("phone") or None, p.get("birth_date") or None,
         p.get("address") or None, int(p["home_studio_id"]),
         p.get("membership_type") if p.get("membership_type") in MEMBERSHIPS else "plus",
         date.today().isoformat(), now_iso()),
    )
    member_id = cur.lastrowid
    conn.commit()
    user = without_password(conn.execute("SELECT * FROM members WHERE id = ?", (member_id,)).fetchone())
    conn.close()
    user["role"] = "member"
    return jsonify({"ok": True, "user": user, "token": make_token(member_id, "member")})


@app.route("/api/members/me", methods=["PATCH"])
@require_auth(["member"])
def update_own_member_profile():
    return update_own_profile("members", MEMBER_PROFILE_FIELDS)


@app.route("/api/employees/me", methods=["PATCH"])
@require_auth(STAFF_ROLES)
def update_own_employee_profile():
    return update_own_profile("employees", EMPLOYEE_PROFILE_FIELDS)


def update_own_profile(table: str, allowed: List[str]):
    p = request.get_json(force=True) or {}
    fields, values = [], []
    for key in allowed:
        if key in p:
            fields.append(f"{key} = ?")
            values.append(p[key] or None)
    if p.get("new_password"):
        conn = get_db()
        row = conn.execute(f"SELECT password FROM {table} WHERE id = ?", (g.current_user["id"],)).fetchone()
        conn.close()
        if not check_password_hash(row["password"], p.get("current_password") or ""):
            return json_error("Das aktuelle Passwort ist falsch.", 403)
        if password_error(p["new_password"]):
            return json_error(password_error(p["new_password"]))
        fields.append("password = ?")
        values.append(generate_password_hash(p["new_password"]))
    if "name" in p and not (p.get("name") or "").strip():
        return json_error("Name darf nicht leer sein.")
    if not fields:
        return json_error("Keine änderbaren Felder gesendet.")
    fields.append("updated_at = ?")
    values.extend([now_iso(), g.current_user["id"]])
    conn = get_db()
    conn.execute(f"UPDATE {table} SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    user = without_password(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (g.current_user["id"],)).fetchone())
    conn.close()
    user["role"] = g.current_user["role"]
    return jsonify({"ok": True, "user": user})


@app.route("/api/courses/<int:course_id>/participants")
@require_auth(STAFF_ROLES)
def course_participants(course_id: int):
    conn = get_db()
    course = get_course_full(conn, course_id)
    if not course:
        conn.close()
        return json_error("Kurs nicht gefunden.", 404)
    me = int(g.current_user["id"])
    if g.current_user["role"] != "admin" and me not in (course.get("trainer_id"), course.get("absent_trainer_id")):
        conn.close()
        return json_error("Teilnehmer sind nur für eigene Kurse sichtbar.", 403)
    rows = conn.execute(
        """
        SELECT m.name FROM bookings b JOIN members m ON m.id = b.member_id
        WHERE b.course_id = ? AND b.status = 'booked' ORDER BY m.name
        """,
        (course_id,),
    ).fetchall()
    conn.close()
    return jsonify({"ok": True, "participants": [r["name"] for r in rows]})


CANCEL_DEADLINE_HOURS = 2

# Membership plans. Prices in euro per month; the order matches MEMBERSHIP_TYPES.
MEMBERSHIPS = {
    "basic": {"name": "Basic", "price": 24.90, "features": ["Training in Ihrem Heimstudio", "4 Kurse pro Monat", "Getränke-Flat gegen Aufpreis"]},
    "plus": {"name": "Plus", "price": 34.90, "features": ["Alle 22 Studios", "Unbegrenzt Kurse", "Getränke-Flat"]},
    "premium": {"name": "Premium", "price": 49.90, "features": ["Alle 22 Studios", "Unbegrenzt Kurse", "Sauna und Wellness", "Trainingsplan-Check jedes Quartal"]},
    "young": {"name": "Young", "price": 19.90, "features": ["Bis 25 Jahre", "Alle 22 Studios", "Unbegrenzt Kurse"]},
}
assert list(MEMBERSHIPS) == MEMBERSHIP_TYPES
MAX_PAUSE_MONTHS_PER_YEAR = 3
BASIC_COURSES_PER_MONTH = 4
YOUNG_MAX_AGE = 25


def month_start(d: date, plus: int = 0) -> date:
    """First day of the month of d, moved by plus months."""
    index = d.year * 12 + d.month - 1 + plus
    return date(index // 12, index % 12 + 1, 1)


def pause_months(start: str, months: int) -> List[date]:
    first = date.fromisoformat(start)
    return [month_start(first, i) for i in range(months)]


def member_paused_on(conn, member_id: int, day: date) -> bool:
    month = month_start(day)
    return any(
        month in pause_months(p["start_month"], p["months"])
        for p in conn.execute("SELECT start_month, months FROM membership_pauses WHERE member_id = ?", (member_id,))
    )


def apply_due_membership_change(conn, member_id: int):
    """A plan change takes effect on the first of the month it was booked for."""
    conn.execute(
        """
        UPDATE members SET membership_type = pending_membership_type, pending_membership_type = NULL, pending_from = NULL
        WHERE id = ? AND pending_from IS NOT NULL AND date(pending_from) <= date(?)
        """,
        (member_id, date.today().isoformat()),
    )


def course_start(course: Dict[str, Any]) -> datetime:
    return datetime.fromisoformat(f"{course['date']}T{course['start_time']}")


def member_booking(conn, member_id: int, course_id: int):
    return conn.execute(
        "SELECT id, status FROM bookings WHERE member_id = ? AND course_id = ? AND status IN ('booked', 'waiting')",
        (member_id, course_id),
    ).fetchone()


def free_places(conn, course: Dict[str, Any]) -> int:
    capacity = conn.execute("SELECT capacity FROM rooms WHERE id = ?", (course["room_id"],)).fetchone()["capacity"]
    booked = conn.execute(
        "SELECT COUNT(*) FROM bookings WHERE course_id = ? AND status = 'booked'", (course["id"],)
    ).fetchone()[0]
    return capacity - booked


def bookable_course(conn, course_id: int):
    """The course if members may book or queue for it, otherwise an error response."""
    course = get_course_full(conn, course_id)
    if not course:
        return None, json_error("Kurs nicht gefunden.", 404)
    if course["status"] != "active":
        return None, json_error("Dieser Kurs kann gerade nicht gebucht werden.")
    if course_start(course) <= datetime.now():
        return None, json_error("Dieser Kurs hat schon begonnen und kann nicht mehr gebucht werden.")
    if member_paused_on(conn, g.current_user["id"], date.fromisoformat(course["date"])):
        return None, json_error("Ihre Mitgliedschaft ist in diesem Monat pausiert. Buchen ist erst danach wieder möglich.")
    member = conn.execute("SELECT membership_type, home_studio_id FROM members WHERE id = ?", (g.current_user["id"],)).fetchone()
    if member["membership_type"] == "basic":
        if course["studio_id"] != member["home_studio_id"]:
            return None, json_error("Mit Basic können Sie nur Kurse in Ihrem Heimstudio buchen. Plus gilt in allen Studios.")
        month = month_start(date.fromisoformat(course["date"]))
        used = conn.execute(
            """
            SELECT COUNT(*) FROM bookings b JOIN courses c ON c.id = b.course_id
            WHERE b.member_id = ? AND b.status IN ('booked', 'waiting') AND c.date >= ? AND c.date < ?
            """,
            (g.current_user["id"], month.isoformat(), month_start(month, 1).isoformat()),
        ).fetchone()[0]
        if used >= BASIC_COURSES_PER_MONTH:
            return None, json_error(
                f"Mit Basic sind {BASIC_COURSES_PER_MONTH} Kurse pro Monat enthalten, die haben Sie bereits gebucht."
            )
    return course, None


@app.route("/api/courses/<int:course_id>/booking", methods=["POST"])
@require_auth(["member"])
def book_course(course_id: int):
    conn = get_db()
    try:
        course, error = bookable_course(conn, course_id)
        if error:
            return error
        member_id = g.current_user["id"]
        existing = member_booking(conn, member_id, course_id)
        if existing and existing["status"] == "booked":
            return json_error("Sie haben diesen Kurs bereits gebucht.", 409)
        if free_places(conn, course) <= 0:
            return json_error("Der Kurs ist leider ausgebucht. Sie können sich auf die Warteliste setzen.", 409)
        if existing:
            conn.execute("UPDATE bookings SET status = 'booked', updated_at = ? WHERE id = ?", (now_iso(), existing["id"]))
        else:
            conn.execute(
                "INSERT INTO bookings (member_id, course_id, booking_date, status, updated_at) VALUES (?, ?, ?, 'booked', ?)",
                (member_id, course_id, now_iso(), now_iso()),
            )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route("/api/courses/<int:course_id>/booking", methods=["DELETE"])
@require_auth(["member"])
def cancel_booking(course_id: int):
    conn = get_db()
    try:
        course = get_course_full(conn, course_id)
        booking = member_booking(conn, g.current_user["id"], course_id)
        if not course or not booking or booking["status"] != "booked":
            return json_error("Keine Buchung für diesen Kurs gefunden.", 404)
        if course_start(course) - datetime.now() < timedelta(hours=CANCEL_DEADLINE_HOURS):
            return json_error(
                f"Stornieren ist nur bis {CANCEL_DEADLINE_HOURS} Stunden vor Kursbeginn möglich."
            )
        conn.execute("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?", (now_iso(), booking["id"]))
        # The freed place goes to the first person on the waiting list.
        first = conn.execute(
            "SELECT id, member_id FROM bookings WHERE course_id = ? AND status = 'waiting' ORDER BY id LIMIT 1",
            (course_id,),
        ).fetchone()
        if first and course["status"] == "active":
            conn.execute("UPDATE bookings SET status = 'booked', updated_at = ? WHERE id = ?", (now_iso(), first["id"]))
            conn.execute(
                "INSERT INTO notifications (recipient_member_id, message, channel, created_at) VALUES (?, ?, 'Website', ?)",
                (first["member_id"], f"Sie sind nachgerückt: Ihr Platz für {course_label(course)} ist jetzt fest gebucht.", now_iso()),
            )
            send_email(
                conn,
                first["member_id"],
                "Sie sind nachgerückt",
                f"Ein Platz ist frei geworden: Ihr Platz für {course_label(course)} ist jetzt fest gebucht.",
            )
        conn.commit()
        return jsonify({"ok": True, "promoted": bool(first)})
    finally:
        conn.close()


@app.route("/api/courses/<int:course_id>/waitlist", methods=["POST"])
@require_auth(["member"])
def join_waitlist(course_id: int):
    conn = get_db()
    try:
        course, error = bookable_course(conn, course_id)
        if error:
            return error
        member_id = g.current_user["id"]
        if member_booking(conn, member_id, course_id):
            return json_error("Sie haben diesen Kurs bereits gebucht oder stehen auf der Warteliste.", 409)
        if free_places(conn, course) > 0:
            return json_error("Es sind noch Plätze frei. Sie können direkt buchen.", 409)
        conn.execute(
            "INSERT INTO bookings (member_id, course_id, booking_date, status, updated_at) VALUES (?, ?, ?, 'waiting', ?)",
            (member_id, course_id, now_iso(), now_iso()),
        )
        position = conn.execute(
            "SELECT COUNT(*) FROM bookings WHERE course_id = ? AND status = 'waiting'", (course_id,)
        ).fetchone()[0]
        conn.commit()
        return jsonify({"ok": True, "position": position})
    finally:
        conn.close()


@app.route("/api/courses/<int:course_id>/waitlist", methods=["DELETE"])
@require_auth(["member"])
def leave_waitlist(course_id: int):
    conn = get_db()
    cur = conn.execute(
        "UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE member_id = ? AND course_id = ? AND status = 'waiting'",
        (now_iso(), g.current_user["id"], course_id),
    )
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return json_error("Sie stehen nicht auf der Warteliste dieses Kurses.", 404)
    return jsonify({"ok": True})


@app.route("/api/members/me/membership", methods=["PUT", "DELETE"])
@require_auth(["member"])
def change_membership():
    """PUT {"type": "premium"} books a plan change for the 1st of next month; DELETE withdraws it."""
    member_id = g.current_user["id"]
    conn = get_db()
    apply_due_membership_change(conn, member_id)
    if request.method == "DELETE":
        conn.execute("UPDATE members SET pending_membership_type = NULL, pending_from = NULL WHERE id = ?", (member_id,))
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    plan = (request.get_json(force=True) or {}).get("type")
    if plan not in MEMBERSHIPS:
        conn.close()
        return json_error("Unbekannte Mitgliedschaft.")
    row = conn.execute("SELECT membership_type, birth_date FROM members WHERE id = ?", (member_id,)).fetchone()
    current = row["membership_type"]
    if plan == "young":
        if not row["birth_date"]:
            conn.close()
            return json_error("Für Young benötigen wir Ihr Geburtsdatum. Bitte tragen Sie es oben in Ihren Daten ein.")
        born = date.fromisoformat(row["birth_date"])
        starts_on = month_start(date.today(), 1)
        age = starts_on.year - born.year - ((starts_on.month, starts_on.day) < (born.month, born.day))
        if age > YOUNG_MAX_AGE:
            conn.close()
            return json_error(f"Young gibt es bis {YOUNG_MAX_AGE} Jahre.")
    if plan == current:
        conn.execute("UPDATE members SET pending_membership_type = NULL, pending_from = NULL WHERE id = ?", (member_id,))
        conn.commit()
        conn.close()
        return json_error("Diese Mitgliedschaft haben Sie bereits.")
    starts = month_start(date.today(), 1).isoformat()
    conn.execute(
        "UPDATE members SET pending_membership_type = ?, pending_from = ?, updated_at = ? WHERE id = ?",
        (plan, starts, now_iso(), member_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "starts": starts})


@app.route("/api/members/me/pauses", methods=["POST"])
@require_auth(["member"])
def add_pause():
    """Body {"start_month": "2026-11-01", "months": 2}. Starts next month at the earliest, max 3 months per calendar year."""
    p = request.get_json(force=True) or {}
    try:
        start = month_start(date.fromisoformat(p.get("start_month") or ""))
        months = int(p.get("months"))
    except (TypeError, ValueError):
        return json_error("Bitte Startmonat und Dauer angeben.")
    next_month = month_start(date.today(), 1)
    if not 1 <= months <= MAX_PAUSE_MONTHS_PER_YEAR:
        return json_error(f"Eine Pause dauert 1 bis {MAX_PAUSE_MONTHS_PER_YEAR} Monate.")
    if not next_month <= start <= month_start(date.today(), 12):
        return json_error("Eine Pause kann frühestens ab nächstem Monat und höchstens 12 Monate im Voraus beginnen.")
    conn = get_db()
    member_id = g.current_user["id"]
    taken = [
        m
        for row in conn.execute("SELECT start_month, months FROM membership_pauses WHERE member_id = ?", (member_id,))
        for m in pause_months(row["start_month"], row["months"])
    ]
    new = pause_months(start.isoformat(), months)
    if set(new) & set(taken):
        conn.close()
        return json_error("Dieser Zeitraum überschneidet sich mit einer bestehenden Pause.")
    for year in {m.year for m in new}:
        used = sum(1 for m in taken + new if m.year == year)
        if used > MAX_PAUSE_MONTHS_PER_YEAR:
            conn.close()
            return json_error(
                f"Pro Kalenderjahr sind höchstens {MAX_PAUSE_MONTHS_PER_YEAR} Monate Pause möglich. "
                f"Für {year} wären es {used}."
            )
    conn.execute(
        "INSERT INTO membership_pauses (member_id, start_month, months, created_at) VALUES (?, ?, ?, ?)",
        (member_id, start.isoformat(), months, now_iso()),
    )
    # Bookings inside the pause are released, so the places go to others.
    first, after = start.isoformat(), month_start(start, months).isoformat()
    released = conn.execute(
        """
        UPDATE bookings SET status = 'cancelled', updated_at = ?
        WHERE member_id = ? AND status IN ('booked', 'waiting')
          AND course_id IN (SELECT id FROM courses WHERE date >= ? AND date < ?)
        """,
        (now_iso(), member_id, first, after),
    ).rowcount
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "released_bookings": released})


@app.route("/api/members/me/pauses/<int:pause_id>", methods=["DELETE"])
@require_auth(["member"])
def delete_pause(pause_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT start_month FROM membership_pauses WHERE id = ? AND member_id = ?", (pause_id, g.current_user["id"])
    ).fetchone()
    if not row:
        conn.close()
        return json_error("Pause nicht gefunden.", 404)
    if date.fromisoformat(row["start_month"]) <= date.today():
        conn.close()
        return json_error("Eine Pause, die schon begonnen hat, kann nicht mehr zurückgenommen werden.")
    conn.execute("DELETE FROM membership_pauses WHERE id = ?", (pause_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Planned leave: trainers request it, the admin approves (runs the same replacement search as a sick report).
# ---------------------------------------------------------------------------
MAX_LEAVE_DAYS = 30


@app.route("/api/leave-requests", methods=["POST"])
@require_auth(STAFF_ROLES)
def request_leave():
    p = request.get_json(force=True) or {}
    try:
        start, end = date.fromisoformat(p.get("start_date") or ""), date.fromisoformat(p.get("end_date") or "")
    except ValueError:
        return json_error("Bitte Start- und Enddatum angeben.")
    if start <= date.today():
        return json_error("Urlaub kann frühestens ab morgen beantragt werden. Für heute bitte eine Krankmeldung eintragen.")
    if end < start:
        return json_error("Das Enddatum liegt vor dem Startdatum.")
    if (end - start).days + 1 > MAX_LEAVE_DAYS:
        return json_error(f"Ein Antrag umfasst höchstens {MAX_LEAVE_DAYS} Tage.")
    employee_id = int(g.current_user["id"])
    conn = get_db()
    overlap = conn.execute(
        """
        SELECT 1 FROM leave_requests WHERE employee_id = ? AND status IN ('pending', 'approved')
          AND date(start_date) <= date(?) AND date(end_date) >= date(?)
        """,
        (employee_id, end.isoformat(), start.isoformat()),
    ).fetchone()
    if overlap:
        conn.close()
        return json_error("Für diesen Zeitraum gibt es bereits einen Antrag.")
    reason = (p.get("reason") or "Urlaub").strip()[:80]
    conn.execute(
        "INSERT INTO leave_requests (employee_id, start_date, end_date, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        (employee_id, start.isoformat(), end.isoformat(), reason, now_iso()),
    )
    create_notification(
        conn, None, f"{g.current_user['name']} beantragt {reason} vom {start:%d.%m.%Y} bis {end:%d.%m.%Y}. Bitte unter „Zeiten“ entscheiden."
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/leave-requests/<int:request_id>/decision", methods=["POST"])
@require_auth(["admin"])
def decide_leave(request_id: int):
    approve = bool((request.get_json(force=True) or {}).get("approve"))
    conn = get_db()
    leave = conn.execute("SELECT * FROM leave_requests WHERE id = ?", (request_id,)).fetchone()
    if not leave or leave["status"] != "pending":
        conn.close()
        return json_error("Dieser Antrag ist nicht mehr offen.", 409)
    employee = conn.execute("SELECT * FROM employees WHERE id = ?", (leave["employee_id"],)).fetchone()
    conn.execute(
        "UPDATE leave_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?",
        ("approved" if approve else "rejected", now_iso(), g.current_user["id"], request_id),
    )
    period = f"{date.fromisoformat(leave['start_date']):%d.%m.%Y} bis {date.fromisoformat(leave['end_date']):%d.%m.%Y}"
    affected = []
    if approve:
        affected = apply_absence(conn, employee, leave["start_date"], leave["end_date"], leave["reason"])
        create_notification(conn, employee["id"], f"Ihr Antrag ({leave['reason']}, {period}) wurde genehmigt.")
    else:
        create_notification(conn, employee["id"], f"Ihr Antrag ({leave['reason']}, {period}) wurde leider abgelehnt.")
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "affected_courses": affected})


@app.route("/api/leave-requests/<int:request_id>", methods=["DELETE"])
@require_auth(STAFF_ROLES)
def withdraw_leave(request_id: int):
    conn = get_db()
    cur = conn.execute(
        "UPDATE leave_requests SET status = 'withdrawn' WHERE id = ? AND employee_id = ? AND status = 'pending'",
        (request_id, g.current_user["id"]),
    )
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return json_error("Nur offene eigene Anträge können zurückgezogen werden.", 404)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Course check-in: the coach ticks off who actually came to their session.
# ---------------------------------------------------------------------------
def own_course_or_error(conn, course_id: int):
    course = get_course_full(conn, course_id)
    if not course:
        return None, json_error("Kurs nicht gefunden.", 404)
    if g.current_user["role"] != "admin" and int(g.current_user["id"]) != course.get("trainer_id"):
        return None, json_error("Einchecken kann nur der Trainer dieses Kurses.", 403)
    return course, None


@app.route("/api/attendance/today")
@require_auth(STAFF_ROLES)
def attendance_today():
    """Today's sessions with booked and checked-in counts: the coach's own, or all of one studio for the admin."""
    today = date.today().isoformat()
    if g.current_user["role"] == "admin":
        studio_id = request.args.get("studio_id", type=int) or g.current_user["home_studio_id"]
        where, args = "r.studio_id = ?", (studio_id,)
    else:
        where, args = "c.trainer_id = ?", (g.current_user["id"],)
    conn = get_db()
    rows = rows_to_list(
        conn.execute(
            f"""
            SELECT c.id, c.start_time, c.duration_minutes, ct.name AS course_type_name, r.name AS room_name,
                   s.name AS studio_name, e.name AS trainer_name,
                   SUM(b.status = 'booked') AS booked, SUM(b.status = 'booked' AND b.attended = 1) AS present
            FROM courses c JOIN course_types ct ON ct.id = c.course_type_id JOIN rooms r ON r.id = c.room_id
            JOIN studios s ON s.id = r.studio_id LEFT JOIN employees e ON e.id = c.trainer_id
            LEFT JOIN bookings b ON b.course_id = c.id
            WHERE c.date = ? AND c.status = 'active' AND {where}
            GROUP BY c.id ORDER BY c.start_time
            """,
            (today, *args),
        ).fetchall()
    )
    conn.close()
    for r in rows:
        r["booked"], r["present"] = r["booked"] or 0, r["present"] or 0
    return jsonify({"ok": True, "courses": rows})


@app.route("/api/courses/<int:course_id>/attendance")
@require_auth(STAFF_ROLES)
def course_attendance(course_id: int):
    conn = get_db()
    course, error = own_course_or_error(conn, course_id)
    if error:
        conn.close()
        return error
    rows = rows_to_list(
        conn.execute(
            """
            SELECT b.id AS booking_id, m.id AS member_id, m.name, m.membership_type, COALESCE(b.attended, 0) AS attended
            FROM bookings b JOIN members m ON m.id = b.member_id
            WHERE b.course_id = ? AND b.status = 'booked' ORDER BY m.name
            """,
            (course_id,),
        ).fetchall()
    )
    conn.close()
    return jsonify({"ok": True, "course": course, "participants": rows})


@app.route("/api/courses/<int:course_id>/scan", methods=["POST"])
@require_auth(STAFF_ROLES)
def scan_member(course_id: int):
    """The coach scans a membership card (QR "FITAKTIV:FA-000123"); the member is checked into this session."""
    raw = ((request.get_json(force=True) or {}).get("code") or "").upper()
    if "MA-" in raw:
        return json_error("Das ist ein Mitarbeiterausweis. Bitte die Mitgliedskarte scannen.")
    digits = "".join(ch for ch in raw.replace("FITAKTIV:", "").replace("FA-", "") if ch.isdigit())
    conn = get_db()
    try:
        course, error = own_course_or_error(conn, course_id)
        if error:
            return error
        if course["date"] != date.today().isoformat():
            return json_error("Eingecheckt wird am Kurstag.")
        member = conn.execute("SELECT id, name FROM members WHERE id = ?", (int(digits) if digits else 0,)).fetchone()
        if not member:
            return json_error("Unbekannte Mitgliedskarte.", 404)
        booking = conn.execute(
            "SELECT id, attended FROM bookings WHERE course_id = ? AND member_id = ? AND status = 'booked'",
            (course_id, member["id"]),
        ).fetchone()
        if not booking:
            return json_error(f"{member['name']} ist für diesen Kurs nicht angemeldet.", 409)
        conn.execute("UPDATE bookings SET attended = 1 WHERE id = ?", (booking["id"],))
        conn.commit()
        return jsonify({"ok": True, "name": member["name"], "booking_id": booking["id"], "already": bool(booking["attended"])})
    finally:
        conn.close()


@app.route("/api/courses/<int:course_id>/attendance", methods=["POST"])
@require_auth(STAFF_ROLES)
def set_attendance(course_id: int):
    """Body {"booking_id": 12, "attended": true}. Only on the day of the course."""
    p = request.get_json(force=True) or {}
    conn = get_db()
    course, error = own_course_or_error(conn, course_id)
    if error:
        conn.close()
        return error
    if course["date"] != date.today().isoformat():
        conn.close()
        return json_error("Eingecheckt wird am Kurstag.")
    cur = conn.execute(
        "UPDATE bookings SET attended = ? WHERE id = ? AND course_id = ? AND status = 'booked'",
        (1 if p.get("attended") else None, p.get("booking_id"), course_id),
    )
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return json_error("Buchung nicht gefunden.", 404)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Admin: email outbox and statistics.
# ---------------------------------------------------------------------------
@app.route("/api/emails")
@require_auth(["admin"])
def email_outbox():
    conn = get_db()
    rows = rows_to_list(
        conn.execute(
            """
            SELECT o.*, m.name AS member_name FROM email_outbox o LEFT JOIN members m ON m.id = o.member_id
            ORDER BY o.id DESC LIMIT 100
            """
        ).fetchall()
    )
    total = conn.execute("SELECT COUNT(*) FROM email_outbox").fetchone()[0]
    conn.close()
    return jsonify({"ok": True, "emails": rows, "total": total})


VAT_RATE = 0.19  # fitness memberships carry the standard German VAT rate (§ 12 Abs. 1 UStG); prices are gross


def billing_context(conn):
    members = conn.execute("SELECT id, membership_type, member_since, home_studio_id FROM members").fetchall()
    pauses: Dict[int, set] = {}
    for p_row in conn.execute("SELECT member_id, start_month, months FROM membership_pauses"):
        pauses.setdefault(p_row["member_id"], set()).update(pause_months(p_row["start_month"], p_row["months"]))
    return members, pauses


def billed_members(members, pauses, month: date):
    """Members who pay for `month`: joined before the month ends and not paused in it.
    ponytail: uses each member's current plan for past months too; a plan history table would make it exact."""
    end = month_start(month, 1)
    for m in members:
        joined = date.fromisoformat(m["member_since"]) if m["member_since"] else date.today()
        if joined < end and month not in pauses.get(m["id"], set()):
            yield m


def plan_price(plan: str) -> float:
    return MEMBERSHIPS.get(plan, {}).get("price", 0)


EMPLOYER_SOCIAL_RATE = 0.21  # employer's share of German social security, flat estimate


def finance_context(conn):
    members, pauses = billing_context(conn)
    return {
        "members": members,
        "pauses": pauses,
        "employees": conn.execute("SELECT id, role, home_studio_id, monthly_salary FROM employees").fetchall(),
        "studios": {r["id"]: dict(r) for r in conn.execute("SELECT id, name, monthly_rent, monthly_energy FROM studios")},
    }


def month_pnl(conn, ctx, month: date) -> Dict[str, Any]:
    """Profit and loss for one month, overall and per studio. All amounts net of VAT.
    ponytail: every current employee counts as employed in every month; hire and leave dates would make it exact."""
    zero = lambda: {k: 0.0 for k in ("revenue", "salaries", "social", "rent", "energy", "wartung", "reparatur",  # noqa: E731
                                     "reinigung", "geraete", "marketing", "verwaltung", "sonstiges")}
    studios = {sid: zero() for sid in ctx["studios"]}
    central = zero()
    members = 0
    for m in billed_members(ctx["members"], ctx["pauses"], month):
        members += 1
        studios.setdefault(m["home_studio_id"], zero())["revenue"] += plan_price(m["membership_type"]) / (1 + VAT_RATE)
    for e in ctx["employees"]:
        target = central if e["role"] == "admin" else studios.setdefault(e["home_studio_id"], zero())
        target["salaries"] += e["monthly_salary"] or 0
        target["social"] += (e["monthly_salary"] or 0) * EMPLOYER_SOCIAL_RATE
    for sid, st in ctx["studios"].items():
        studios[sid]["rent"] += st["monthly_rent"] or 0
        studios[sid]["energy"] += st["monthly_energy"] or 0
    for row in conn.execute(
        "SELECT studio_id, category, SUM(amount_net) AS total FROM expenses WHERE date >= ? AND date < ? GROUP BY 1, 2",
        (month.isoformat(), month_start(month, 1).isoformat()),
    ):
        target = studios.get(row["studio_id"], central) if row["studio_id"] else central
        target[row["category"] if row["category"] in target else "sonstiges"] += row["total"]
    total = zero()
    for part in [*studios.values(), central]:
        for k, v in part.items():
            total[k] += v
    return {"total": total, "studios": studios, "central": central, "members": members}


def costs_of(part: Dict[str, float]) -> float:
    return sum(v for k, v in part.items() if k != "revenue")


@app.route("/api/stats")
@require_auth(["admin"])
def statistics():
    """Business figures for the admin dashboard, all computed from the local database."""
    conn = get_db()
    today = date.today()
    past_from = (today - timedelta(days=28)).isoformat()

    plans = {k: {"name": v["name"], "price": v["price"], "members": 0} for k, v in MEMBERSHIPS.items()}
    for row in conn.execute("SELECT membership_type, COUNT(*) AS n FROM members GROUP BY membership_type"):
        if row["membership_type"] in plans:
            plans[row["membership_type"]]["members"] = row["n"]

    # Revenue per month: members who had joined by the end of the month and were not paused, at their plan's price.
    members, pauses = billing_context(conn)
    fctx = finance_context(conn)
    revenue = []
    for i in range(5, -1, -1):
        month = month_start(today, -i)
        paying = list(billed_members(members, pauses, month))
        new = sum(1 for m in members if m["member_since"] and month_start(date.fromisoformat(m["member_since"])) == month)
        pnl = month_pnl(conn, fctx, month)
        revenue.append(
            {"month": month.isoformat(), "revenue": round(sum(plan_price(m["membership_type"]) for m in paying), 2),
             "members": len(paying), "new_members": new,
             "revenue_net": round(pnl["total"]["revenue"], 2), "costs": round(costs_of(pnl["total"]), 2),
             "result": round(pnl["total"]["revenue"] - costs_of(pnl["total"]), 2)}
        )
    current = month_pnl(conn, fctx, month_start(today))
    cost_breakdown = {k: round(v, 2) for k, v in current["total"].items() if k != "revenue"}
    studio_results = sorted(
        (
            {"name": fctx["studios"][sid]["name"], "revenue": round(p["revenue"], 2), "costs": round(costs_of(p), 2),
             "result": round(p["revenue"] - costs_of(p), 2),
             "personnel": round(p["salaries"] + p["social"], 2)}
            for sid, p in current["studios"].items()
        ),
        key=lambda x: -x["result"],
    )
    studio_names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM studios")}
    by_studio: Dict[int, float] = {}
    for m in billed_members(members, pauses, month_start(today)):
        by_studio[m["home_studio_id"]] = by_studio.get(m["home_studio_id"], 0) + plan_price(m["membership_type"])
    revenue_by_studio = sorted(
        ({"name": studio_names.get(k, "?"), "revenue": round(v, 2)} for k, v in by_studio.items()),
        key=lambda x: -x["revenue"],
    )
    course_types = rows_to_list(
        conn.execute(
            """
            SELECT ct.name, COUNT(DISTINCT c.id) AS courses,
                   SUM(b.status = 'booked') AS booked,
                   SUM(b.status = 'booked' AND b.attended = 1) AS attended,
                   (SELECT ROUND(AVG(rt.stars), 2) FROM ratings rt JOIN courses c2 ON c2.id = rt.course_id
                    WHERE c2.course_type_id = ct.id) AS avg_rating
            FROM course_types ct JOIN courses c ON c.course_type_id = ct.id
            LEFT JOIN bookings b ON b.course_id = c.id
            WHERE c.status = 'active' AND c.date >= ? AND c.date < ?
            GROUP BY ct.id ORDER BY booked DESC
            """,
            (past_from, today.isoformat()),
        ).fetchall()
    )
    trainers = rows_to_list(
        conn.execute(
            """
            SELECT e.name, s.name AS studio_name, COUNT(DISTINCT c.id) AS courses,
                   ROUND(AVG(rt.stars), 2) AS avg_rating, COUNT(rt.stars) AS ratings
            FROM employees e JOIN studios s ON s.id = e.home_studio_id
            JOIN courses c ON c.trainer_id = e.id LEFT JOIN ratings rt ON rt.course_id = c.id
            WHERE c.status = 'active' AND c.date < ?
            GROUP BY e.id HAVING ratings >= 3 ORDER BY avg_rating DESC, ratings DESC LIMIT 8
            """,
            (today.isoformat(),),
        ).fetchall()
    )

    occupancy = rows_to_list(
        conn.execute(
            """
            SELECT s.id, s.name, COUNT(c.id) AS courses, COALESCE(SUM(r.capacity), 0) AS seats,
                   COALESCE(SUM(b.n), 0) AS booked
            FROM studios s JOIN rooms r ON r.studio_id = s.id JOIN courses c ON c.room_id = r.id
            LEFT JOIN (SELECT course_id, COUNT(*) AS n FROM bookings WHERE status = 'booked' GROUP BY course_id) b
                ON b.course_id = c.id
            WHERE c.status = 'active' AND c.date >= ? AND c.date < ?
            GROUP BY s.id ORDER BY s.id
            """,
            (past_from, today.isoformat()),
        ).fetchall()
    )

    # Busiest times: average bookings per course by weekday and start hour, over the last 8 weeks and the next 2.
    heat: Dict[Tuple[int, int], List[int]] = {}
    for row in conn.execute(
        """
        SELECT c.date, c.start_time, COALESCE(b.n, 0) AS n
        FROM courses c
        LEFT JOIN (SELECT course_id, COUNT(*) AS n FROM bookings WHERE status = 'booked' GROUP BY course_id) b
            ON b.course_id = c.id
        WHERE c.status = 'active' AND c.date BETWEEN ? AND ?
        """,
        ((today - timedelta(days=56)).isoformat(), (today + timedelta(days=14)).isoformat()),
    ):
        key = (date.fromisoformat(row["date"]).weekday(), int(row["start_time"][:2]))
        heat.setdefault(key, []).append(row["n"])
    busiest = [
        {"weekday": wd, "hour": hr, "avg": round(sum(v) / len(v), 2), "courses": len(v)} for (wd, hr), v in sorted(heat.items())
    ]

    window = conn.execute(
        """
        SELECT SUM(b.status = 'booked') AS booked, SUM(b.status = 'cancelled') AS cancelled,
               SUM(b.status = 'booked' AND c.date < ?) AS past_booked,
               SUM(b.status = 'booked' AND c.date < ? AND b.attended = 1) AS attended
        FROM bookings b JOIN courses c ON c.id = b.course_id
        WHERE c.date >= ? AND c.date <= ?
        """,
        (today.isoformat(), today.isoformat(), past_from, (today + timedelta(days=28)).isoformat()),
    ).fetchone()
    booked, cancelled = window["booked"] or 0, window["cancelled"] or 0
    past_booked, attended = window["past_booked"] or 0, window["attended"] or 0

    avg_rating = conn.execute("SELECT ROUND(AVG(stars), 2), COUNT(*) FROM ratings").fetchone()
    checkins_today = conn.execute(
        """
        SELECT COUNT(*) FROM bookings b JOIN courses c ON c.id = b.course_id
        WHERE c.date = ? AND b.status = 'booked' AND b.attended = 1
        """,
        (today.isoformat(),),
    ).fetchone()[0]
    paused_now = sum(1 for m in members if month_start(today) in pauses.get(m["id"], set()))
    conn.close()
    return jsonify(
        {
            "ok": True,
            "plans": plans,
            "revenue": revenue,
            "revenue_by_studio": revenue_by_studio,
            "cost_breakdown": cost_breakdown,
            "central_costs": round(costs_of(current["central"]), 2),
            "studio_results": studio_results,
            "course_types": course_types,
            "top_trainers": trainers,
            "occupancy": occupancy,
            "busiest": busiest,
            "cancellation_rate": round(cancelled / (booked + cancelled), 3) if booked + cancelled else 0,
            "no_show_rate": round(1 - attended / past_booked, 3) if past_booked else 0,
            "members_total": len(members),
            "paused_now": paused_now,
            "avg_rating": avg_rating[0],
            "rating_count": avg_rating[1],
            "checkins_today": checkins_today,
        }
    )


# ---------------------------------------------------------------------------
# Admin portal: overview, members and trial requests.
# ---------------------------------------------------------------------------
TRIAL_STATUSES = ("neu", "kontaktiert", "erledigt")


@app.route("/api/admin/overview")
@require_auth(["admin"])
def admin_overview():
    """Everything waiting for the admin today, in one call."""
    conn = get_db()
    sync_absence_status(conn)
    today = date.today()
    t = today.isoformat()
    in_14 = (today + timedelta(days=14)).isoformat()
    todays = conn.execute(
        """
        SELECT COUNT(DISTINCT c.id) AS courses,
               COALESCE(SUM(b.status = 'booked'), 0) AS booked,
               COALESCE(SUM(b.status = 'booked' AND b.attended = 1), 0) AS present
        FROM courses c LEFT JOIN bookings b ON b.course_id = c.id
        WHERE c.date = ? AND c.status = 'active'
        """,
        (t,),
    ).fetchone()
    open_courses = rows_to_list(
        conn.execute(
            """
            SELECT c.id, c.date, c.start_time, ct.name AS course_type_name, s.name AS studio_name,
                   (SELECT COUNT(*) FROM bookings b WHERE b.course_id = c.id AND b.status = 'booked') AS booked
            FROM courses c JOIN course_types ct ON ct.id = c.course_type_id JOIN rooms r ON r.id = c.room_id
            JOIN studios s ON s.id = r.studio_id
            WHERE (c.status = 'needs_replacement' OR (c.status = 'active' AND c.trainer_id IS NULL))
              AND c.date BETWEEN ? AND ?
            ORDER BY c.date, c.start_time
            """,
            (t, in_14),
        ).fetchall()
    )
    pending_leave = rows_to_list(
        conn.execute(
            """
            SELECT l.id, l.start_date, l.end_date, l.reason, e.name AS employee_name
            FROM leave_requests l JOIN employees e ON e.id = l.employee_id
            WHERE l.status = 'pending' ORDER BY l.start_date
            """
        ).fetchall()
    )
    sick = rows_to_list(
        conn.execute(
            """
            SELECT e.id, e.name, e.unavailable_reason, e.unavailable_to, s.name AS studio_name
            FROM employees e JOIN studios s ON s.id = e.home_studio_id
            WHERE e.status = 'unavailable' ORDER BY e.unavailable_to
            """
        ).fetchall()
    )
    trials = rows_to_list(
        conn.execute(
            """
            SELECT t.id, t.name, t.created_at, s.name AS studio_name
            FROM trial_requests t LEFT JOIN studios s ON s.id = t.studio_id
            WHERE t.status = 'neu' ORDER BY t.id DESC
            """
        ).fetchall()
    )
    month = today.replace(day=1).isoformat()
    new_members = conn.execute("SELECT COUNT(*) FROM members WHERE member_since >= ?", (month,)).fetchone()[0]
    newest = rows_to_list(
        conn.execute(
            """
            SELECT m.id, m.name, m.membership_type, m.member_since, s.name AS studio_name
            FROM members m LEFT JOIN studios s ON s.id = m.home_studio_id
            ORDER BY m.member_since DESC, m.id % 22, m.id DESC LIMIT 5
            """
        ).fetchall()
    )
    unread = conn.execute(
        "SELECT COUNT(*) FROM notifications WHERE recipient_member_id IS NULL AND is_read = 0"
    ).fetchone()[0]

    monday, sunday = week_bounds(t)
    week = dict(
        conn.execute(
            """
            SELECT SUM(status = 'active') AS active, SUM(status = 'cancelled') AS cancelled,
                   SUM(status = 'needs_replacement') AS open
            FROM courses WHERE date BETWEEN ? AND ?
            """,
            (monday, sunday),
        ).fetchone()
    )
    next_month = month_start(today, 1).isoformat()
    changes = rows_to_list(
        conn.execute(
            """
            SELECT membership_type AS old, pending_membership_type AS new, COUNT(*) AS n
            FROM members WHERE pending_membership_type IS NOT NULL GROUP BY 1, 2
            """
        ).fetchall()
    )
    change_effect = round(sum((plan_price(c["new"]) - plan_price(c["old"])) * c["n"] for c in changes), 2)
    pauses_next = conn.execute(
        "SELECT COUNT(*) FROM membership_pauses WHERE start_month = ?", (next_month,)
    ).fetchone()[0]
    studio_occ = rows_to_list(
        conn.execute(
            """
            SELECT s.name, COALESCE(SUM(b.n), 0) * 1.0 / SUM(r.capacity) AS rate
            FROM studios s JOIN rooms r ON r.studio_id = s.id JOIN courses c ON c.room_id = r.id
            LEFT JOIN (SELECT course_id, COUNT(*) AS n FROM bookings WHERE status = 'booked' GROUP BY course_id) b
                ON b.course_id = c.id
            WHERE c.status = 'active' AND c.date >= ? AND c.date < ?
            GROUP BY s.id ORDER BY rate
            """,
            ((today - timedelta(days=28)).isoformat(), t),
        ).fetchall()
    )
    load = rows_to_list(
        conn.execute(
            """
            SELECT e.name, e.max_courses_per_week AS max, COUNT(c.id) AS courses
            FROM employees e LEFT JOIN courses c ON c.trainer_id = e.id AND c.status = 'active' AND c.date BETWEEN ? AND ?
            WHERE e.role = 'trainer' AND e.status = 'available'
            GROUP BY e.id
            """,
            (monday, sunday),
        ).fetchall()
    )
    full_trainers = sorted((x for x in load if x["max"] and x["courses"] >= x["max"]), key=lambda x: -x["courses"])
    idle_trainers = sorted((x for x in load if x["courses"] <= 1), key=lambda x: x["courses"])
    low_ratings = rows_to_list(
        conn.execute(
            """
            SELECT rt.stars, c.date, ct.name AS course_type_name, e.name AS trainer_name, s.name AS studio_name
            FROM ratings rt JOIN courses c ON c.id = rt.course_id JOIN course_types ct ON ct.id = c.course_type_id
            LEFT JOIN employees e ON e.id = c.trainer_id JOIN rooms r ON r.id = c.room_id JOIN studios s ON s.id = r.studio_id
            WHERE rt.stars <= 2 AND c.date >= ? ORDER BY c.date DESC LIMIT 5
            """,
            ((today - timedelta(days=30)).isoformat(),),
        ).fetchall()
    )
    fin = month_pnl(conn, finance_context(conn), month_start(today))["total"]
    finance_snapshot = {
        "revenue": round(fin["revenue"], 2),
        "costs": round(costs_of(fin), 2),
        "result": round(fin["revenue"] - costs_of(fin), 2),
        "personnel": round(fin["salaries"] + fin["social"], 2),
    }
    conn.commit()
    conn.close()
    return jsonify(
        {
            "ok": True,
            "today": dict(todays),
            "open_courses": open_courses,
            "pending_leave": pending_leave,
            "sick": sick,
            "trials": trials,
            "new_members_month": new_members,
            "newest_members": newest,
            "unread": unread,
            "week": {k: v or 0 for k, v in week.items()},
            "plan_changes": {"count": sum(c["n"] for c in changes), "effect": change_effect, "from": next_month},
            "pauses_next_month": pauses_next,
            "studios_low": studio_occ[:3],
            "studios_high": studio_occ[-3:][::-1],
            "trainers_full": full_trainers[:5],
            "trainers_idle": idle_trainers[:5],
            "trainers_idle_count": len(idle_trainers),
            "low_ratings": low_ratings,
            "finance": finance_snapshot,
        }
    )


@app.route("/api/admin/members")
@require_auth(["admin"])
def admin_members():
    q = (request.args.get("q") or "").strip()
    studio_id = request.args.get("studio_id", type=int)
    plan = request.args.get("plan")
    offset = max(0, request.args.get("offset", default=0, type=int))
    where, args = ["1 = 1"], []
    if q:
        digits = "".join(ch for ch in q if ch.isdigit())
        if q.upper().startswith("FA-") and digits:
            where.append("m.id = ?")
            args.append(int(digits))
        else:
            where.append("(m.name LIKE ? OR m.email LIKE ?)")
            args += [f"%{q}%", f"%{q}%"]
    if studio_id:
        where.append("m.home_studio_id = ?")
        args.append(studio_id)
    if plan in MEMBERSHIPS:
        where.append("m.membership_type = ?")
        args.append(plan)
    clause = " AND ".join(where)
    conn = get_db()
    total = conn.execute(f"SELECT COUNT(*) FROM members m WHERE {clause}", args).fetchone()[0]
    rows = rows_to_list(
        conn.execute(
            f"""
            SELECT m.id, m.name, m.email, m.membership_type, m.member_since, m.pending_membership_type,
                   s.name AS studio_name,
                   (SELECT COUNT(*) FROM bookings b JOIN courses c ON c.id = b.course_id
                    WHERE b.member_id = m.id AND b.status = 'booked' AND c.date >= date('now')) AS upcoming
            FROM members m LEFT JOIN studios s ON s.id = m.home_studio_id
            WHERE {clause} ORDER BY m.name LIMIT 50 OFFSET ?
            """,
            (*args, offset),
        ).fetchall()
    )
    paused = {
        r["member_id"]
        for r in conn.execute("SELECT member_id, start_month, months FROM membership_pauses").fetchall()
        if month_start(date.today()) in pause_months(r["start_month"], r["months"])
    }
    conn.close()
    for r in rows:
        r["paused"] = r["id"] in paused
    return jsonify({"ok": True, "total": total, "members": rows})


@app.route("/api/admin/members/<int:member_id>")
@require_auth(["admin"])
def admin_member_detail(member_id: int):
    conn = get_db()
    member = conn.execute(
        "SELECT m.*, s.name AS studio_name FROM members m LEFT JOIN studios s ON s.id = m.home_studio_id WHERE m.id = ?",
        (member_id,),
    ).fetchone()
    if not member:
        conn.close()
        return json_error("Mitglied nicht gefunden.", 404)
    bookings = rows_to_list(
        conn.execute(
            """
            SELECT b.id, b.status, b.attended, c.date, c.start_time, ct.name AS course_type_name, s.name AS studio_name
            FROM bookings b JOIN courses c ON c.id = b.course_id JOIN course_types ct ON ct.id = c.course_type_id
            JOIN rooms r ON r.id = c.room_id JOIN studios s ON s.id = r.studio_id
            WHERE b.member_id = ? ORDER BY c.date DESC, c.start_time DESC LIMIT 30
            """,
            (member_id,),
        ).fetchall()
    )
    past = [b for b in bookings if b["status"] == "booked" and b["date"] < date.today().isoformat()]
    pauses = rows_to_list(
        conn.execute("SELECT start_month, months FROM membership_pauses WHERE member_id = ? ORDER BY start_month", (member_id,))
    )
    rating = conn.execute("SELECT ROUND(AVG(stars), 1), COUNT(*) FROM ratings WHERE member_id = ?", (member_id,)).fetchone()
    conn.close()
    return jsonify(
        {
            "ok": True,
            "member": without_password(member),
            "bookings": bookings,
            "attendance": {"past": len(past), "attended": sum(1 for b in past if b["attended"])},
            "pauses": pauses,
            "rating": {"avg": rating[0], "count": rating[1]},
        }
    )


@app.route("/api/admin/members/<int:member_id>", methods=["PATCH"])
@require_auth(["admin"])
def admin_update_member(member_id: int):
    """The admin changes plan or home studio immediately (members themselves wait for the next month)."""
    p = request.get_json(force=True) or {}
    fields, values = [], []
    if "membership_type" in p:
        if p["membership_type"] not in MEMBERSHIPS:
            return json_error("Unbekannte Mitgliedschaft.")
        fields += ["membership_type = ?", "pending_membership_type = NULL", "pending_from = NULL"]
        values.append(p["membership_type"])
    conn = get_db()
    if "home_studio_id" in p:
        if not conn.execute("SELECT 1 FROM studios WHERE id = ?", (p["home_studio_id"],)).fetchone():
            conn.close()
            return json_error("Studio nicht gefunden.")
        fields.append("home_studio_id = ?")
        values.append(p["home_studio_id"])
    if not fields:
        conn.close()
        return json_error("Keine änderbaren Felder gesendet.")
    cur = conn.execute(f"UPDATE members SET {', '.join(fields)}, updated_at = ? WHERE id = ?", (*values, now_iso(), member_id))
    if cur.rowcount:
        conn.execute(
            "INSERT INTO notifications (recipient_member_id, message, channel, created_at) VALUES (?, ?, 'Website', ?)",
            (member_id, "Die Studioleitung hat Ihre Mitgliedschaft aktualisiert. Details finden Sie unter „Mein Profil“.", now_iso()),
        )
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return json_error("Mitglied nicht gefunden.", 404)
    return jsonify({"ok": True})


BWA_LINES = [
    # key, label, kind (line | sum | result), parts
    ("revenue", "Umsatzerlöse Mitgliedsbeiträge", "line", ["revenue"]),
    ("gesamtleistung", "Gesamtleistung", "sum", ["revenue"]),
    ("salaries", "Löhne und Gehälter", "line", ["salaries"]),
    ("social", "Gesetzliche soziale Aufwendungen", "line", ["social"]),
    ("personnel", "Personalkosten", "sum", ["salaries", "social"]),
    ("rent", "Miete", "line", ["rent"]),
    ("energy", "Energie (Strom, Heizung, Wasser)", "line", ["energy"]),
    ("rooms", "Raumkosten", "sum", ["rent", "energy"]),
    ("wartung", "Wartung Trainingsgeräte", "line", ["wartung"]),
    ("reparatur", "Reparaturen", "line", ["reparatur"]),
    ("maintenance", "Instandhaltung", "sum", ["wartung", "reparatur"]),
    ("reinigung", "Reinigung", "line", ["reinigung"]),
    ("geraete", "Geräte und Ausstattung (GWG)", "line", ["geraete"]),
    ("marketing", "Werbekosten", "line", ["marketing"]),
    ("verwaltung", "Verwaltung und IT", "line", ["verwaltung"]),
    ("sonstiges", "Sonstige Kosten", "line", ["sonstiges"]),
    ("costs", "Gesamtkosten", "sum", ["salaries", "social", "rent", "energy", "wartung", "reparatur", "reinigung",
                                      "geraete", "marketing", "verwaltung", "sonstiges"]),
    ("result", "Betriebsergebnis", "result", None),
]


@app.route("/api/admin/finance")
@require_auth(["admin"])
def finance_report():
    """BWA (betriebswirtschaftliche Auswertung) for one month and cumulated from January, plus results per studio."""
    try:
        month = month_start(date.fromisoformat((request.args.get("month") or date.today().isoformat()[:7]) + "-01"))
    except ValueError:
        return json_error("Monat im Format JJJJ-MM angeben.")
    conn = get_db()
    ctx = finance_context(conn)
    pnl = month_pnl(conn, ctx, month)
    ytd = None
    m = month.replace(month=1)
    while m <= month:
        part = month_pnl(conn, ctx, m)["total"]
        ytd = part if ytd is None else {k: ytd[k] + v for k, v in part.items()}
        m = month_start(m, 1)
    prev = month_pnl(conn, ctx, month_start(month, -1))["total"]

    def value(part, parts, kind):
        if kind == "result":
            return part["revenue"] - costs_of(part)
        return sum(part[p] for p in parts)

    lines = []
    for key, label, kind, parts in BWA_LINES:
        mv, yv = value(pnl["total"], parts, kind), value(ytd, parts, kind)
        lines.append(
            {"key": key, "label": label, "kind": kind, "month": round(mv, 2), "ytd": round(yv, 2),
             "month_pct": mv / pnl["total"]["revenue"] if pnl["total"]["revenue"] else 0,
             "ytd_pct": yv / ytd["revenue"] if ytd["revenue"] else 0,
             "previous": round(value(prev, parts, kind), 2)}
        )
    studios = [
        {"name": ctx["studios"][sid]["name"], "revenue": round(p["revenue"], 2),
         "personnel": round(p["salaries"] + p["social"], 2), "rooms": round(p["rent"] + p["energy"], 2),
         "other": round(costs_of(p) - p["salaries"] - p["social"] - p["rent"] - p["energy"], 2),
         "result": round(p["revenue"] - costs_of(p), 2)}
        for sid, p in sorted(pnl["studios"].items())
    ]
    c = pnl["central"]
    central = {"personnel": round(c["salaries"] + c["social"], 2), "other": round(costs_of(c) - c["salaries"] - c["social"], 2)}
    expenses = rows_to_list(
        conn.execute(
            """
            SELECT x.id, x.date, x.category, x.description, x.amount_net, s.name AS studio_name
            FROM expenses x LEFT JOIN studios s ON s.id = x.studio_id
            WHERE x.date >= ? AND x.date < ? ORDER BY x.date DESC, x.id DESC
            """,
            (month.isoformat(), month_start(month, 1).isoformat()),
        ).fetchall()
    )
    gross = sum(plan_price(mm["membership_type"]) for mm in billed_members(ctx["members"], ctx["pauses"], month))
    conn.close()
    return jsonify(
        {
            "ok": True,
            "month": month.isoformat(),
            "document_no": f"BWA-{month:%Y-%m}",
            "vat_rate": VAT_RATE,
            "social_rate": EMPLOYER_SOCIAL_RATE,
            "lines": lines,
            "studios": studios,
            "central": central,
            "members": pnl["members"],
            "revenue_gross": round(gross, 2),
            "vat": round(gross - pnl["total"]["revenue"], 2),
            "expenses": expenses,
            "categories": EXPENSE_CATEGORIES,
            "created_at": now_iso(),
            "created_by": g.current_user["name"],
        }
    )


@app.route("/api/admin/expenses", methods=["POST"])
@require_auth(["admin"])
def add_expense():
    p = request.get_json(force=True) or {}
    try:
        day = date.fromisoformat(p.get("date") or "")
        amount = round(float(p.get("amount_net")), 2)
    except (TypeError, ValueError):
        return json_error("Bitte Datum und Betrag angeben.")
    if amount <= 0:
        return json_error("Der Betrag muss größer als 0 sein.")
    if p.get("category") not in EXPENSE_CATEGORIES:
        return json_error("Unbekannte Kategorie.")
    description = (p.get("description") or "").strip()[:120]
    if not description:
        return json_error("Bitte eine Beschreibung angeben.")
    conn = get_db()
    studio_id = p.get("studio_id") or None
    if studio_id and not conn.execute("SELECT 1 FROM studios WHERE id = ?", (studio_id,)).fetchone():
        conn.close()
        return json_error("Studio nicht gefunden.")
    conn.execute(
        "INSERT INTO expenses (date, studio_id, category, description, amount_net, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (day.isoformat(), studio_id, p["category"], description, amount, g.current_user["id"], now_iso()),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/admin/expenses/<int:expense_id>", methods=["DELETE"])
@require_auth(["admin"])
def delete_expense(expense_id: int):
    conn = get_db()
    cur = conn.execute("DELETE FROM expenses WHERE id = ?", (expense_id,))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return json_error("Ausgabe nicht gefunden.", 404)
    return jsonify({"ok": True})


@app.route("/api/admin/trial-requests")
@require_auth(["admin"])
def admin_trial_requests():
    conn = get_db()
    rows = rows_to_list(
        conn.execute(
            """
            SELECT t.*, s.name AS studio_name, ct.name AS course_type_name
            FROM trial_requests t LEFT JOIN studios s ON s.id = t.studio_id
            LEFT JOIN course_types ct ON ct.id = t.course_type_id
            ORDER BY CASE t.status WHEN 'neu' THEN 0 WHEN 'kontaktiert' THEN 1 ELSE 2 END, t.created_at DESC LIMIT 200
            """
        ).fetchall()
    )
    conn.close()
    return jsonify({"ok": True, "requests": rows})


@app.route("/api/admin/trial-requests/<int:request_id>", methods=["PATCH"])
@require_auth(["admin"])
def admin_update_trial(request_id: int):
    status = (request.get_json(force=True) or {}).get("status")
    if status not in TRIAL_STATUSES:
        return json_error("Unbekannter Status.")
    conn = get_db()
    cur = conn.execute("UPDATE trial_requests SET status = ? WHERE id = ?", (status, request_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        return json_error("Anfrage nicht gefunden.", 404)
    return jsonify({"ok": True})


@app.route("/api/members/me/favorites", methods=["POST", "DELETE"])
@require_auth(["member"])
def toggle_favorite():
    p = request.get_json(force=True) or {}
    kind, target_id = p.get("kind"), p.get("target_id")
    if kind not in ("course_type", "trainer") or not isinstance(target_id, int):
        return json_error("Ungültiger Favorit.")
    conn = get_db()
    if request.method == "POST":
        conn.execute(
            "INSERT OR IGNORE INTO favorites (member_id, kind, target_id) VALUES (?, ?, ?)",
            (g.current_user["id"], kind, target_id),
        )
    else:
        conn.execute(
            "DELETE FROM favorites WHERE member_id = ? AND kind = ? AND target_id = ?",
            (g.current_user["id"], kind, target_id),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/courses/<int:course_id>/rating", methods=["POST"])
@require_auth(["member"])
def rate_course(course_id: int):
    stars = (request.get_json(force=True) or {}).get("stars")
    if stars not in (1, 2, 3, 4, 5):
        return json_error("Bitte 1 bis 5 Sterne vergeben.")
    conn = get_db()
    try:
        course = get_course_full(conn, course_id)
        booking = member_booking(conn, g.current_user["id"], course_id)
        if not course or not booking or booking["status"] != "booked":
            return json_error("Bewerten können Sie nur Kurse, die Sie gebucht haben.", 403)
        if course_start(course) + timedelta(minutes=int(course["duration_minutes"] or 60)) > datetime.now():
            return json_error("Bewerten geht erst, wenn der Kurs vorbei ist.")
        conn.execute(
            """
            INSERT INTO ratings (member_id, course_id, stars, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (member_id, course_id) DO UPDATE SET stars = excluded.stars, created_at = excluded.created_at
            """,
            (g.current_user["id"], course_id, stars, now_iso()),
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route("/api/trial-requests", methods=["POST"])
def create_trial_request():
    p = request.get_json(force=True) or {}
    name = (p.get("name") or "").strip()
    email = (p.get("email") or "").strip()
    missing = [k for k, v in {"name": name, "email": email, "studio_id": p.get("studio_id")}.items() if not v]
    if missing:
        return json_error("Pflichtfelder fehlen.", details=missing)
    if "@" not in email:
        return json_error("Bitte eine gültige E-Mail-Adresse eingeben.")
    conn = get_db()
    studio = conn.execute("SELECT name FROM studios WHERE id = ?", (int(p["studio_id"]),)).fetchone()
    if not studio:
        conn.close()
        return json_error("Studio nicht gefunden.")
    course_type = None
    if p.get("course_type_id"):
        course_type = conn.execute("SELECT name FROM course_types WHERE id = ?", (int(p["course_type_id"]),)).fetchone()
    conn.execute(
        """
        INSERT INTO trial_requests (name, email, phone, studio_id, course_type_id, preferred_date, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (name, email, p.get("phone") or None, int(p["studio_id"]), int(p["course_type_id"]) if course_type else None,
         p.get("preferred_date") or None, (p.get("message") or "").strip() or None, now_iso()),
    )
    contact = f"{email}, {p['phone']}" if p.get("phone") else email
    details = [f"Probetraining-Anfrage von {name} ({contact}) für {studio['name']}"]
    if course_type:
        details.append(f"Kurs: {course_type['name']}")
    if p.get("preferred_date"):
        details.append(f"Wunschtermin: {p['preferred_date']}")
    if (p.get("message") or "").strip():
        details.append(f"Nachricht: {p['message'].strip()}")
    create_notification(conn, None, ". ".join(details) + ".")
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/employees", methods=["POST"])
@require_auth(["admin"])
def create_employee():
    p = request.get_json(force=True) or {}
    required = ["name", "email", "password", "qualifications", "employment_model", "home_studio_id"]
    missing = [k for k in required if not p.get(k)]
    if missing:
        return json_error("Pflichtfelder fehlen.", details=missing)
    if password_error(p["password"]):
        return json_error(password_error(p["password"]))
    employment_model = p.get("employment_model")
    weekly_hours = 40 if employment_model == "Vollzeit" else 10
    max_courses = 20 if employment_model == "Vollzeit" else 6
    conn = get_db()
    try:
        cur = conn.execute(
            """
            INSERT INTO employees
            (name, email, password, role, qualifications, employment_model, weekly_hours, max_courses_per_week,
             can_travel, home_studio_id, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
            """,
            (
                p["name"],
                p["email"],
                generate_password_hash(p["password"]),
                p.get("role") or "trainer",
                p["qualifications"],
                employment_model,
                p.get("weekly_hours") or weekly_hours,
                p.get("max_courses_per_week") or max_courses,
                1 if p.get("can_travel", True) else 0,
                int(p["home_studio_id"]),
                now_iso(),
            ),
        )
        emp_id = cur.lastrowid
        salary = p.get("monthly_salary")
        conn.execute(
            "UPDATE employees SET monthly_salary = ? WHERE id = ?",
            (float(salary) if salary not in (None, "") else default_salary(float(p.get("weekly_hours") or weekly_hours), p.get("role") or "trainer", emp_id), emp_id),
        )
        for weekday, start, end in default_availability(emp_id, int(p.get("weekly_hours") or weekly_hours)):
            conn.execute(
                "INSERT INTO availabilities (employee_id, weekday, start_time, end_time, updated_at) VALUES (?, ?, ?, ?, ?)",
                (emp_id, weekday, start, end, now_iso()),
            )
        create_notification(conn, emp_id, f"Mitarbeiter {p['name']} wurde angelegt.")
        conn.commit()
    except Exception as exc:
        conn.rollback()
        conn.close()
        return json_error(f"Mitarbeiter konnte nicht erstellt werden: {exc}")
    conn.close()
    return jsonify({"ok": True, "id": emp_id})


@app.route("/api/employees/<int:employee_id>", methods=["PATCH"])
@require_auth(["admin"])
def update_employee(employee_id: int):
    p = request.get_json(force=True) or {}
    allowed = [
        "name", "email", "password", "role", "qualifications", "employment_model", "weekly_hours",
        "max_courses_per_week", "can_travel", "home_studio_id", "status", "unavailable_reason",
        "unavailable_from", "unavailable_to", "monthly_salary",
    ]
    if "monthly_salary" in p:
        try:
            if float(p["monthly_salary"]) < 0:
                raise ValueError
        except (TypeError, ValueError):
            return json_error("Bitte ein gültiges Monatsgehalt angeben.")
    if "password" in p:
        if password_error(p["password"] or ""):
            return json_error(password_error(p["password"] or ""))
        p["password"] = generate_password_hash(p["password"])
    fields, values = [], []
    for key in allowed:
        if key in p:
            fields.append(f"{key} = ?")
            values.append(p[key])
    if not fields:
        return json_error("Keine änderbaren Felder gesendet.")
    fields.append("updated_at = ?")
    values.append(now_iso())
    values.append(employee_id)
    conn = get_db()
    conn.execute(f"UPDATE employees SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/employees/<int:employee_id>", methods=["DELETE"])
@require_auth(["admin"])
def delete_employee(employee_id: int):
    conn = get_db()
    assigned = conn.execute("SELECT COUNT(*) AS c FROM courses WHERE trainer_id = ?", (employee_id,)).fetchone()["c"]
    if assigned:
        conn.close()
        return json_error("Mitarbeiter ist noch Kursen zugewiesen. Entferne zuerst die Zuweisungen.")
    conn.execute("DELETE FROM employees WHERE id = ?", (employee_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/employees/<int:employee_id>/absence", methods=["POST"])
@require_auth(STAFF_ROLES)
def create_absence(employee_id: int):
    if g.current_user.get("role") != "admin" and int(g.current_user.get("id")) != int(employee_id):
        return json_error("Mitarbeiter dürfen nur ihre eigene Krankmeldung eintragen.", 403)
    p = request.get_json(force=True) or {}
    reason = p.get("reason") or "Krankmeldung"
    start_date = p.get("start_date") or date.today().isoformat()
    end_date = p.get("end_date") or start_date
    conn = get_db()
    employee = conn.execute("SELECT * FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if not employee:
        conn.close()
        return json_error("Mitarbeiter nicht gefunden.", 404)

    affected = apply_absence(conn, employee, start_date, end_date, reason)
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "affected_courses": affected})


def apply_absence(conn, employee, start_date: str, end_date: str, reason: str) -> List[Dict[str, Any]]:
    """Record an absence (sickness or approved leave) and hand every affected course to a replacement or cancel it."""
    employee_id = employee["id"]
    conn.execute(
        "INSERT INTO absences (employee_id, reason, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?)",
        (employee_id, reason, start_date, end_date, now_iso()),
    )
    # The status only flips once the absence has begun; planned leave weeks ahead keeps the trainer available.
    if date.fromisoformat(start_date) <= date.today():
        conn.execute(
            """
            UPDATE employees
            SET status = 'unavailable', unavailable_reason = ?, unavailable_from = ?, unavailable_to = ?, updated_at = ?
            WHERE id = ?
            """,
            (reason, start_date, end_date, now_iso(), employee_id),
        )
    affected_rows = conn.execute(
        """
        SELECT c.id FROM courses c
        WHERE c.trainer_id = ? AND c.status = 'active'
          AND date(c.date) BETWEEN date(?) AND date(?)
        ORDER BY c.date, c.start_time
        """,
        (employee_id, start_date, end_date),
    ).fetchall()

    affected = []
    for row in affected_rows:
        course_id = row["id"]
        label = course_label(get_course_full(conn, course_id))
        # Courses are handled one by one, so each assignment counts towards
        # the next course's limits and conflict checks.
        candidates = replacement_candidates(conn, course_id, limit=1)
        if candidates:
            sub = candidates[0]
            conn.execute(
                "UPDATE courses SET status = 'active', trainer_id = ?, absent_trainer_id = ?, updated_at = ? WHERE id = ?",
                (sub["id"], employee_id, now_iso(), course_id),
            )
            create_notification(conn, sub["id"], f"Sie übernehmen als Ersatztrainer: {label}.")
            create_notification(
                conn, None, f"{label}: {employee['name']} fällt aus, {sub['name']} übernimmt automatisch."
            )
            notify_booked_members(
                conn,
                course_id,
                f"Trainerwechsel: {label} findet statt, {sub['name']} leitet den Kurs als Vertretung.",
                email_subject="Trainerwechsel in Ihrem Kurs",
            )
        else:
            conn.execute(
                "UPDATE courses SET status = 'cancelled', trainer_id = NULL, absent_trainer_id = ?, updated_at = ? WHERE id = ?",
                (employee_id, now_iso(), course_id),
            )
            create_notification(conn, None, f"{label} wurde abgesagt: kein Ersatztrainer gefunden.")
            notify_booked_members(
                conn,
                course_id,
                f"Es tut uns leid: {label} muss leider ausfallen, weil kurzfristig keine Vertretung gefunden wurde. "
                "Wir hoffen, Sie bald in einem anderen Kurs zu sehen.",
                include_waiting=True,
                email_subject="Ihr Kurs fällt leider aus",
            )
        affected.append({"course_id": course_id, "replacement": candidates[0] if candidates else None})

    create_notification(conn, employee_id, f"Sie sind vom {start_date} bis {end_date} als nicht verfügbar markiert ({reason}).")
    return affected



AVAILABILITY_WEEKS_AHEAD = 4
WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


@app.route("/api/employees/<int:employee_id>/availability", methods=["PUT"])
@require_auth(STAFF_ROLES)
def set_availability(employee_id: int):
    """Set one calendar week. Body: {"week_start": "2026-10-12", "slots": [{"weekday": 0, "start_time": "08:00", "end_time": "14:00"}]}"""
    if g.current_user.get("role") != "admin" and int(g.current_user.get("id")) != int(employee_id):
        return json_error("Mitarbeiter dürfen nur ihre eigene Verfügbarkeit ändern.", 403)
    p = request.get_json(force=True) or {}
    slots = p.get("slots")
    if not isinstance(slots, list):
        return json_error("slots fehlt.")
    this_monday = date.fromisoformat(week_bounds(date.today().isoformat())[0])
    try:
        monday = date.fromisoformat(p.get("week_start") or "")
    except ValueError:
        return json_error("week_start fehlt.")
    if monday.weekday() != 0 or not 0 <= (monday - this_monday).days // 7 < AVAILABILITY_WEEKS_AHEAD:
        return json_error(f"Nur die aktuelle und die nächsten {AVAILABILITY_WEEKS_AHEAD - 1} Wochen sind planbar.")

    clean = []
    for slot in slots:
        try:
            weekday = int(slot["weekday"])
            start, end = parse_time_to_minutes(slot["start_time"]), parse_time_to_minutes(slot["end_time"])
        except (KeyError, TypeError, ValueError):
            return json_error("Ungültige Zeitangabe.")
        if not 0 <= weekday <= 6 or not 0 <= start < end <= 24 * 60:
            return json_error("Die Endzeit muss nach der Startzeit liegen.")
        if any(c["weekday"] == weekday for c in clean):
            return json_error("Pro Tag ist nur ein Zeitraum möglich.")
        clean.append({"weekday": weekday, "start_time": slot["start_time"], "end_time": slot["end_time"]})

    conn = get_db()
    employee = conn.execute("SELECT id, weekly_hours, max_courses_per_week FROM employees WHERE id = ?", (employee_id,)).fetchone()
    if not employee:
        conn.close()
        return json_error("Mitarbeiter nicht gefunden.", 404)

    def slot_hours(items) -> float:
        return sum(parse_time_to_minutes(c["end_time"]) - parse_time_to_minutes(c["start_time"]) for c in items) / 60

    low, high = availability_bounds(employee["weekly_hours"])
    hours = slot_hours(clean)
    if hours < low:
        conn.close()
        return json_error(f"Sie haben {hours:g} Stunden eingetragen. Mindestens {low} Stunden pro Woche sind nötig.")

    # A course that fits the current times must still fit the new ones: assigned courses are never dropped silently.
    old = week_availability(conn, employee_id, monday.isoformat())
    courses = conn.execute(
        """
        SELECT c.date, c.start_time, c.duration_minutes, ct.name AS course_type_name
        FROM courses c JOIN course_types ct ON ct.id = c.course_type_id
        WHERE c.trainer_id = ? AND c.status = 'active' AND date(c.date) BETWEEN date(?) AND date(?)
        ORDER BY c.date, c.start_time
        """,
        (employee_id, monday.isoformat(), (monday + timedelta(days=6)).isoformat()),
    ).fetchall()
    for c in courses:
        weekday = date.fromisoformat(c["date"]).weekday()
        start_min = parse_time_to_minutes(c["start_time"])
        end_min = start_min + int(c["duration_minutes"] or 60)
        if slots_cover(old, weekday, start_min, end_min) and not slots_cover(clean, weekday, start_min, end_min):
            conn.close()
            return json_error(
                f"Am {WEEKDAY_NAMES[weekday]} haben Sie um {c['start_time']} Uhr {c['course_type_name']}. "
                "Diese Zeit können Sie nicht austragen. Bitte melden Sie sich für den Tag krank oder lassen Sie den Kurs umplanen."
            )

    # Availability has no upper limit, but a week that is already fully planned
    # (course limit or maximum hours reached) cannot grow: no more courses could be added anyway.
    planned = sum(int(c["duration_minutes"] or 60) for c in courses) / 60
    full = len(courses) >= int(employee["max_courses_per_week"]) or planned >= high
    if full and hours > slot_hours(old):
        conn.close()
        return json_error(
            f"Diese Woche ist mit {len(courses)} Kursen ({planned:g} Std.) schon voll verplant. "
            "Sie können keine weitere Verfügbarkeit eintragen, nur gleich viel oder weniger."
        )

    conn.execute("DELETE FROM availabilities WHERE employee_id = ? AND week_start = ?", (employee_id, monday.isoformat()))
    conn.executemany(
        "INSERT INTO availabilities (employee_id, weekday, start_time, end_time, week_start, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [(employee_id, c["weekday"], c["start_time"], c["end_time"], monday.isoformat(), now_iso()) for c in clean],
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "hours": hours})


@app.route("/api/courses/<int:course_id>/message", methods=["POST"])
@require_auth(STAFF_ROLES)
def message_participants(course_id: int):
    text = ((request.get_json(force=True) or {}).get("text") or "").strip()
    if not text:
        return json_error("Bitte eine Nachricht eingeben.")
    if len(text) > 500:
        return json_error("Die Nachricht darf höchstens 500 Zeichen lang sein.")
    conn = get_db()
    course = get_course_full(conn, course_id)
    if not course:
        conn.close()
        return json_error("Kurs nicht gefunden.", 404)
    if g.current_user["role"] != "admin" and int(g.current_user["id"]) != course.get("trainer_id"):
        conn.close()
        return json_error("Nachrichten kann nur der Trainer dieses Kurses senden.", 403)
    count = conn.execute(
        "SELECT COUNT(*) FROM bookings WHERE course_id = ? AND status = 'booked'", (course_id,)
    ).fetchone()[0]
    if not count:
        conn.close()
        return json_error("Für diesen Kurs hat noch niemand gebucht.")
    notify_booked_members(conn, course_id, f"Nachricht von {g.current_user['name']} zu {course_label(course)}: {text}")
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "recipients": count})


@app.route("/api/employees/<int:employee_id>/available", methods=["POST"])
@require_auth(STAFF_ROLES)
def mark_employee_available(employee_id: int):
    if g.current_user.get("role") != "admin" and int(g.current_user.get("id")) != int(employee_id):
        return json_error("Mitarbeiter dürfen nur ihren eigenen Status ändern.", 403)
    conn = get_db()
    today = date.today().isoformat()
    conn.execute(
        "UPDATE employees SET status = 'available', unavailable_reason = NULL, unavailable_from = NULL, unavailable_to = NULL, updated_at = ? WHERE id = ?",
        (now_iso(), employee_id),
    )
    # Remove current/future sick periods so validation no longer treats the trainer as absent.
    conn.execute(
        "DELETE FROM absences WHERE employee_id = ? AND date(end_date) >= date(?)",
        (employee_id, today),
    )

    affected_rows = conn.execute(
        """
        SELECT id FROM courses
        WHERE absent_trainer_id = ?
          AND date(date) >= date(?)
        ORDER BY date, start_time
        """,
        (employee_id, today),
    ).fetchall()

    restored_courses = []
    kept_replacements = []
    for row in affected_rows:
        course = get_course_full(conn, row["id"])
        if not course:
            continue
        # If a replacement has already been assigned, keep that trainer and remove the sick marker.
        if course.get("trainer_id"):
            conn.execute(
                "UPDATE courses SET absent_trainer_id = NULL, updated_at = ? WHERE id = ?",
                (now_iso(), course["id"]),
            )
            kept_replacements.append(course["id"])
            continue

        # It was originally this employee's shift. When they mark themselves available again
        # and no replacement has taken over yet, put it back on their plan.
        conn.execute(
            "UPDATE courses SET trainer_id = ?, absent_trainer_id = NULL, status = 'active', updated_at = ? WHERE id = ?",
            (employee_id, now_iso(), course["id"]),
        )
        restored_courses.append(course["id"])

    create_notification(conn, employee_id, "Sie sind wieder als verfügbar markiert.")
    if restored_courses:
        create_notification(conn, employee_id, f"{len(restored_courses)} Ihrer Kurse wurden Ihnen wieder zugeordnet.")
    if kept_replacements:
        create_notification(conn, employee_id, f"{len(kept_replacements)} Kurse bleiben beim bereits eingeteilten Ersatztrainer.")
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "restored_courses": restored_courses, "kept_replacements": kept_replacements})



def generate_random_courses_between(conn, start_day: date, end_day: date, seed_label: str) -> Dict[str, Any]:
    course_types = rows_to_list(conn.execute("SELECT * FROM course_types ORDER BY id").fetchall())
    rooms = rows_to_list(
        conn.execute(
            """
            SELECT r.*, s.name AS studio_name
            FROM rooms r
            JOIN studios s ON s.id = r.studio_id
            WHERE r.id IN (SELECT MIN(id) FROM rooms GROUP BY studio_id)
            ORDER BY r.studio_id
            """
        ).fetchall()
    )
    employees = rows_to_list(conn.execute("SELECT * FROM employees ORDER BY id").fetchall())
    for emp in employees:
        emp["qualification_set"] = {
            q.strip().lower() for q in (emp.get("qualifications") or "").split(",") if q.strip()
        }
        emp["monthly_limit"] = employee_monthly_course_limit(emp)

    # employee -> week_start (None = standard week) -> weekday -> [(start, end)]
    availability_by_employee: Dict[int, Dict[Optional[str], Dict[int, List[Tuple[int, int]]]]] = {}
    for row in conn.execute("SELECT * FROM availabilities").fetchall():
        availability_by_employee.setdefault(int(row["employee_id"]), {}).setdefault(row["week_start"], {}).setdefault(
            int(row["weekday"]), []
        ).append((parse_time_to_minutes(row["start_time"]), parse_time_to_minutes(row["end_time"])))

    absences_by_employee: Dict[int, List[Tuple[date, date]]] = {}
    for row in conn.execute("SELECT employee_id, start_date, end_date FROM absences").fetchall():
        absences_by_employee.setdefault(int(row["employee_id"]), []).append(
            (date.fromisoformat(row["start_date"]), date.fromisoformat(row["end_date"]))
        )

    weekly_counts: Dict[Tuple[int, str], int] = {}
    monthly_counts: Dict[Tuple[int, str], int] = {}
    daily_courses: Dict[int, Dict[str, List[Dict[str, Any]]]] = {}

    def add_assigned_course_to_cache(trainer_id: int, course_date: str, start_time: str, duration_minutes: int, studio_id: int):
        week_key = (trainer_id, week_bounds(course_date)[0])
        month_key = (trainer_id, month_bounds(course_date)[0])
        weekly_counts[week_key] = weekly_counts.get(week_key, 0) + 1
        monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1
        start_min = parse_time_to_minutes(start_time)
        daily_courses.setdefault(trainer_id, {}).setdefault(course_date, []).append(
            {
                "start": start_min,
                "end": start_min + int(duration_minutes or 60),
                "studio_id": int(studio_id),
            }
        )

    for row in conn.execute(
        """
        SELECT c.trainer_id, c.date, c.start_time, c.duration_minutes, r.studio_id
        FROM courses c
        JOIN rooms r ON r.id = c.room_id
        WHERE c.trainer_id IS NOT NULL
          AND c.status IN ('active', 'needs_replacement')
        """
    ).fetchall():
        add_assigned_course_to_cache(
            int(row["trainer_id"]),
            row["date"],
            row["start_time"],
            int(row["duration_minutes"] or 60),
            int(row["studio_id"]),
        )

    def cached_employee_absent(emp: Dict[str, Any], course_day: date) -> bool:
        if emp.get("status") == "unavailable":
            unavailable_from = emp.get("unavailable_from")
            unavailable_to = emp.get("unavailable_to")
            if unavailable_from and unavailable_to:
                if date.fromisoformat(unavailable_from) <= course_day <= date.fromisoformat(unavailable_to):
                    return True
            else:
                return True
        for start_absence, end_absence in absences_by_employee.get(int(emp["id"]), []):
            if start_absence <= course_day <= end_absence:
                return True
        return False

    def cached_employee_available(emp_id: int, week_start: str, weekday: int, start_min: int, end_min: int) -> bool:
        weeks = availability_by_employee.get(emp_id, {})
        week = weeks.get(week_start) or weeks.get(None, {})
        for available_start, available_end in week.get(weekday, []):
            if available_start <= start_min and end_min <= available_end:
                return True
        return False

    def cached_time_conflict(emp_id: int, course_date: str, start_min: int, end_min: int, studio_id: int) -> bool:
        for existing in daily_courses.get(emp_id, {}).get(course_date, []):
            if int(existing["studio_id"]) == int(studio_id):
                buffer_start, buffer_end = existing["start"], existing["end"]
            else:
                buffer_start, buffer_end = existing["start"] - 60, existing["end"] + 60
            if start_min < buffer_end and end_min > buffer_start:
                return True
        return False

    def pick_random_trainer_fast(course: Dict[str, Any], rng: random.Random) -> Optional[int]:
        required = (course.get("required_qualification") or "").strip().lower()
        course_day = date.fromisoformat(course["date"])
        weekday = course_day.weekday()
        start_min = parse_time_to_minutes(course["start_time"])
        end_min = start_min + int(course.get("duration_minutes") or 60)
        week_start = week_bounds(course["date"])[0]
        month_start = month_bounds(course["date"])[0]
        valid: List[Dict[str, Any]] = []
        shuffled = employees[:]
        rng.shuffle(shuffled)

        for emp in shuffled:
            emp_id = int(emp["id"])
            studio_id = int(course["studio_id"])
            if required and required not in emp["qualification_set"]:
                continue
            if cached_employee_absent(emp, course_day):
                continue
            if not cached_employee_available(emp_id, week_start, weekday, start_min, end_min):
                continue
            weekly_load = weekly_counts.get((emp_id, week_start), 0)
            if weekly_load >= int(emp["max_courses_per_week"]):
                continue
            monthly_load = monthly_counts.get((emp_id, month_start), 0)
            if int(emp["monthly_limit"] or 0) and monthly_load >= int(emp["monthly_limit"]):
                continue
            if cached_time_conflict(emp_id, course["date"], start_min, end_min, studio_id):
                continue
            if not int(emp.get("can_travel") or 0) and int(emp["home_studio_id"]) != studio_id:
                continue
            valid.append(
                {
                    "id": emp_id,
                    "same_studio": int(emp["home_studio_id"]) == studio_id,
                    "monthly_load": monthly_load,
                    "weekly_load": weekly_load,
                }
            )

        if not valid:
            return None
        valid.sort(key=lambda e: (0 if e["same_studio"] else 1, e["monthly_load"], e["weekly_load"], rng.random()))
        return int(valid[0]["id"])

    def choose_course_type_and_trainer(course_date: str, start_time: str, room: Dict[str, Any], rng: random.Random) -> Tuple[Optional[Dict[str, Any]], Optional[int]]:
        """Pick a course type only if a real trainer can teach it.

        The older generator picked a random course type first. That produced thousands
        of "Ersatz nötig" rows because some qualifications are mostly available in
        the morning, while the generator also created evening courses. This version
        tries all course types in random order and only creates the course when a
        trainer can actually take it.
        """
        shuffled_types = course_types[:]
        rng.shuffle(shuffled_types)
        for course_type in shuffled_types:
            course_for_validation = {
                "course_type_id": int(course_type["id"]),
                "required_qualification": course_type["required_qualification"],
                "date": course_date,
                "start_time": start_time,
                "duration_minutes": 60,
                "room_id": int(room["id"]),
                "studio_id": int(room["studio_id"]),
            }
            trainer_id = pick_random_trainer_fast(course_for_validation, rng)
            if trainer_id:
                return course_type, trainer_id
        return None, None

    time_slots = ["08:00", "10:00", "12:00", "17:00", "19:00"]
    rng = random.Random(f"{seed_label}-{start_day.isoformat()}-{end_day.isoformat()}-{now_iso()}")
    generated: List[Dict[str, Any]] = []
    skipped_existing = 0
    skipped_no_trainer = 0

    current_day = start_day
    while current_day <= end_day:
        if current_day.weekday() >= 5:
            current_day += timedelta(days=1)
            continue

        course_date = current_day.isoformat()
        for room in rooms:
            # Keep a maximum of two generated courses per studio/room/day. This is
            # important when an older generated database is repaired: after deleting
            # old unassigned rows, we only fill missing room/day slots instead of
            # adding extra courses at different random times.
            existing_times = [
                row["start_time"]
                for row in conn.execute(
                    """
                    SELECT start_time FROM courses
                    WHERE date = ? AND room_id = ?
                    """,
                    (course_date, room["id"]),
                ).fetchall()
            ]
            remaining_slots = max(0, 2 - len(existing_times))
            if remaining_slots <= 0:
                skipped_existing += len(existing_times)
                continue

            available_times = [slot for slot in time_slots if slot not in set(existing_times)]
            chosen_times = rng.sample(available_times, k=min(remaining_slots, len(available_times)))
            for start_time in chosen_times:
                course_type, trainer_id = choose_course_type_and_trainer(course_date, start_time, room, rng)
                if not course_type or not trainer_id:
                    skipped_no_trainer += 1
                    continue

                cur = conn.execute(
                    """
                    INSERT INTO courses
                    (course_type_id, date, start_time, duration_minutes, room_id, trainer_id, absent_trainer_id, status, special_event, updated_at)
                    VALUES (?, ?, ?, 60, ?, ?, NULL, 'active', 0, ?)
                    """,
                    (course_type["id"], course_date, start_time, room["id"], trainer_id, now_iso()),
                )
                add_assigned_course_to_cache(
                    int(trainer_id),
                    course_date,
                    start_time,
                    60,
                    int(room["studio_id"]),
                )
                generated.append(
                    {
                        "id": cur.lastrowid,
                        "date": course_date,
                        "start_time": start_time,
                        "studio_id": room["studio_id"],
                        "studio_name": room["studio_name"],
                        "course_type": course_type["name"],
                        "trainer_id": trainer_id,
                        "status": "active",
                    }
                )
        current_day += timedelta(days=1)

    return {
        "start_date": start_day.isoformat(),
        "end_date": end_day.isoformat(),
        "generated": generated,
        "skipped_existing": skipped_existing,
        "skipped_no_trainer": skipped_no_trainer,
    }

def generate_random_courses_for_week(conn, week_date_text: str) -> Dict[str, Any]:
    requested = date.fromisoformat(week_date_text)
    monday = requested - timedelta(days=requested.weekday())
    result = generate_random_courses_between(conn, monday, monday + timedelta(days=4), "week")
    return {"week_start": monday.isoformat(), **result}


def generate_random_courses_for_year(conn, year: int) -> Dict[str, Any]:
    if year < 2000 or year > 2100:
        raise ValueError("Bitte ein Jahr zwischen 2000 und 2100 eingeben.")
    start_day = date(year, 1, 1)
    end_day = date(year, 12, 31)
    result = generate_random_courses_between(conn, start_day, end_day, f"year-{year}")
    return {"year": year, **result}


def count_workdays_in_year(year: int) -> int:
    current = date(year, 1, 1)
    end_day = date(year, 12, 31)
    count = 0
    while current <= end_day:
        if current.weekday() < 5:
            count += 1
        current += timedelta(days=1)
    return count


def year_course_count(conn, year: int) -> int:
    return int(
        conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM courses
            WHERE date(date) >= date(?) AND date(date) <= date(?)
            """,
            (f"{year}-01-01", f"{year}-12-31"),
        ).fetchone()["c"]
    )


def cleanup_mass_unassigned_generated_courses(conn, year: int) -> int:
    """Remove old auto-generated replacement rows from the previous generator.

    The earlier yearly generator inserted a course even when no trainer was
    available, which created thousands of "Ersatz nötig" rows. We only clean
    this up when there are many such rows, so normal manually-created replacement
    cases are not removed accidentally.
    """
    threshold = int(os.environ.get("FITAKTIV_CLEANUP_UNASSIGNED_THRESHOLD", "100"))
    params = (f"{year}-01-01", f"{year}-12-31")
    count = int(
        conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM courses c
            WHERE c.status = 'needs_replacement'
              AND c.trainer_id IS NULL
              AND c.absent_trainer_id IS NULL
              AND c.special_event = 0
              AND date(c.date) >= date(?) AND date(c.date) <= date(?)
              AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.course_id = c.id)
            """,
            params,
        ).fetchone()["c"]
    )
    if count < threshold:
        return 0
    cur = conn.execute(
        """
        DELETE FROM courses
        WHERE status = 'needs_replacement'
          AND trainer_id IS NULL
          AND absent_trainer_id IS NULL
          AND special_event = 0
          AND date(date) >= date(?) AND date(date) <= date(?)
          AND id NOT IN (SELECT course_id FROM bookings)
        """,
        params,
    )
    return int(cur.rowcount or 0)


def expected_generated_courses_for_year(conn, year: int) -> int:
    generated_rooms = int(
        conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM rooms r
            WHERE r.id IN (SELECT MIN(id) FROM rooms GROUP BY studio_id)
            """
        ).fetchone()["c"]
    )
    return count_workdays_in_year(year) * generated_rooms * 2


def ensure_app_settings_table(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def set_app_setting(conn, key: str, value: str):
    ensure_app_settings_table(conn)
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, now_iso()),
    )


def get_app_setting(conn, key: str) -> Optional[str]:
    ensure_app_settings_table(conn)
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def auto_generate_current_year_courses_if_needed() -> Dict[str, Any]:
    """Generate the current year's random courses automatically on backend start.

    It is safe to run repeatedly: existing room/date/time slots are skipped, and
    the setting key prevents doing the expensive full-year check every startup
    once the year is already filled. Set FITAKTIV_AUTO_YEAR_COURSES=0 to disable.
    """
    if os.environ.get("FITAKTIV_AUTO_YEAR_COURSES", "1").lower() in {"0", "false", "no", "off"}:
        return {"ok": True, "auto_generated": False, "reason": "disabled"}

    year = date.today().year
    conn = get_db()
    try:
        cleaned_unassigned = cleanup_mass_unassigned_generated_courses(conn, year)
        if cleaned_unassigned:
            conn.commit()

        expected = expected_generated_courses_for_year(conn, year)
        existing = year_course_count(conn, year)
        flag_key = f"auto_year_courses_generated_{year}"
        already_marked = get_app_setting(conn, flag_key) == "done"

        # If the year already looks filled, only store the flag and skip.
        if already_marked and existing >= int(expected * 0.90):
            conn.close()
            return {"ok": True, "auto_generated": False, "reason": "already_done", "year": year, "existing": existing, "expected": expected}
        if existing >= int(expected * 0.90):
            set_app_setting(conn, flag_key, "done")
            conn.commit()
            conn.close()
            return {"ok": True, "auto_generated": False, "reason": "already_enough_courses", "year": year, "existing": existing, "expected": expected}

        result = generate_random_courses_for_year(conn, year)
        generated_count = len(result["generated"])
        set_app_setting(conn, flag_key, "done")
        create_notification(
            conn,
            None,
            f"Automatische Jahreskurse für {year} erstellt: {generated_count} neu, {result['skipped_existing']} bereits vorhanden, {result['skipped_no_trainer']} ohne Trainer.",
        )
        conn.commit()
        return {
            "ok": True,
            "auto_generated": generated_count > 0,
            "year": year,
            "generated_count": generated_count,
            "skipped_existing": result["skipped_existing"],
            "skipped_no_trainer": result["skipped_no_trainer"],
            "cleaned_unassigned": cleaned_unassigned,
            "expected": expected,
            "before_existing": existing,
        }
    finally:
        try:
            conn.close()
        except Exception:
            pass


@app.route("/api/courses/generate-week", methods=["POST"])
@require_auth(["admin"])
def generate_week_courses():
    p = request.get_json(force=True) or {}
    week_start = p.get("week_start") or date.today().isoformat()
    conn = get_db()
    result = generate_random_courses_for_week(conn, week_start)
    create_notification(
        conn,
        None,
        f"Wochenkurse ab {result['week_start']} generiert: {len(result['generated'])} neu, {result['skipped_existing']} bereits vorhanden.",
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, **result})


@app.route("/api/courses/generate-year", methods=["POST"])
@require_auth(["admin"])
def generate_year_courses():
    p = request.get_json(force=True) or {}
    year = int(p.get("year") or date.today().year)
    conn = get_db()
    try:
        cleaned_unassigned = cleanup_mass_unassigned_generated_courses(conn, year)
        if cleaned_unassigned:
            conn.commit()
        result = generate_random_courses_for_year(conn, year)
    except ValueError as exc:
        conn.close()
        return json_error(str(exc))
    generated_count = len(result["generated"])
    create_notification(
        conn,
        None,
        f"Jahreskurse für {year} generiert: {generated_count} neu, {result['skipped_existing']} bereits vorhanden, {result['skipped_no_trainer']} ohne Trainer.",
    )
    conn.commit()
    conn.close()
    return jsonify({
        "ok": True,
        "year": result["year"],
        "start_date": result["start_date"],
        "end_date": result["end_date"],
        "generated_count": generated_count,
        "generated_sample": result["generated"][:20],
        "skipped_existing": result["skipped_existing"],
        "skipped_no_trainer": result["skipped_no_trainer"],
        "cleaned_unassigned": cleaned_unassigned,
    })


@app.route("/api/courses", methods=["POST"])
@require_auth(["admin"])
def create_course():
    p = request.get_json(force=True) or {}
    required = ["course_type_id", "date", "start_time", "room_id"]
    missing = [k for k in required if not p.get(k)]
    if missing:
        return json_error("Pflichtfelder fehlen.", details=missing)
    trainer_id = p.get("trainer_id") or None
    conn = get_db()
    course_for_validation = {
        "course_type_id": int(p["course_type_id"]),
        "date": p["date"],
        "start_time": p["start_time"],
        "duration_minutes": int(p.get("duration_minutes") or 60),
        "room_id": int(p["room_id"]),
        "studio_id": get_studio_id_for_room(conn, int(p["room_id"])),
    }
    if trainer_id:
        type_row = conn.execute("SELECT required_qualification FROM course_types WHERE id = ?", (course_for_validation["course_type_id"],)).fetchone()
        course_for_validation["required_qualification"] = type_row["required_qualification"] if type_row else ""
        ok, reasons = validate_trainer_for_course(conn, int(trainer_id), course_for_validation)
        if not ok:
            conn.close()
            return json_error("Trainer kann diesem Kurs nicht zugewiesen werden.", details=reasons)
    cur = conn.execute(
        """
        INSERT INTO courses
        (course_type_id, date, start_time, duration_minutes, room_id, trainer_id, absent_trainer_id, status, special_event, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        """,
        (
            int(p["course_type_id"]),
            p["date"],
            p["start_time"],
            int(p.get("duration_minutes") or 60),
            int(p["room_id"]),
            int(trainer_id) if trainer_id else None,
            p.get("status") or ("active" if trainer_id else "needs_replacement"),
            1 if p.get("special_event") else 0,
            now_iso(),
        ),
    )
    course_id = cur.lastrowid
    if trainer_id:
        create_notification(conn, int(trainer_id), f"Sie wurden eingeteilt: {course_label(get_course_full(conn, course_id))}.")
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": course_id})


@app.route("/api/courses/<int:course_id>", methods=["PATCH"])
@require_auth(["admin"])
def update_course(course_id: int):
    p = request.get_json(force=True) or {}
    allowed = ["course_type_id", "date", "start_time", "duration_minutes", "room_id", "trainer_id", "status", "special_event"]
    fields, values = [], []
    for key in allowed:
        if key in p:
            fields.append(f"{key} = ?")
            values.append(p[key])
    if not fields:
        return json_error("Keine änderbaren Felder gesendet.")
    fields.append("updated_at = ?")
    values.append(now_iso())
    values.append(course_id)
    conn = get_db()
    conn.execute(f"UPDATE courses SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/courses/<int:course_id>", methods=["DELETE"])
@require_auth(["admin"])
def delete_course(course_id: int):
    conn = get_db()
    conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/courses/<int:course_id>/assign", methods=["POST"])
@require_auth(["admin"])
def assign_course(course_id: int):
    p = request.get_json(force=True) or {}
    trainer_id = p.get("trainer_id")
    if not trainer_id:
        return json_error("trainer_id fehlt.")
    conn = get_db()
    course = get_course_full(conn, course_id)
    if not course:
        conn.close()
        return json_error("Kurs nicht gefunden.", 404)
    ok, reasons = validate_trainer_for_course(conn, int(trainer_id), course, exclude_course_id=course_id)
    if not ok:
        conn.close()
        return json_error("Zuweisung blockiert: Konflikt erkannt.", details=reasons)
    conn.execute(
        "UPDATE courses SET trainer_id = ?, status = 'active', updated_at = ? WHERE id = ?",
        (int(trainer_id), now_iso(), course_id),
    )
    employee = conn.execute("SELECT name FROM employees WHERE id = ?", (trainer_id,)).fetchone()
    label = course_label(course)
    create_notification(conn, int(trainer_id), f"Sie übernehmen als Ersatztrainer: {label}.")
    create_notification(conn, None, f"{label} wurde {employee['name'] if employee else 'einem Trainer'} zugewiesen.")
    notify_booked_members(
        conn,
        course_id,
        f"Trainerwechsel: {label} findet statt, {employee['name'] if employee else 'eine Vertretung'} leitet den Kurs.",
        email_subject="Trainerwechsel in Ihrem Kurs",
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/courses/<int:course_id>/cancel", methods=["POST"])
@require_auth(["admin"])
def cancel_course(course_id: int):
    conn = get_db()
    course = get_course_full(conn, course_id)
    if not course:
        conn.close()
        return json_error("Kurs nicht gefunden.", 404)
    conn.execute("UPDATE courses SET status = 'cancelled', trainer_id = NULL, updated_at = ? WHERE id = ?", (now_iso(), course_id))
    label = course_label(course)
    create_notification(conn, course.get("trainer_id"), f"{label} wurde als ausgefallen markiert.")
    notify_booked_members(
        conn,
        course_id,
        f"Es tut uns leid: {label} muss leider ausfallen.",
        include_waiting=True,
        email_subject="Ihr Kurs fällt leider aus",
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/replacements")
@require_auth(["admin"])
def replacements():
    course_id = request.args.get("course_id", type=int)
    if not course_id:
        return json_error("course_id fehlt.")
    conn = get_db()
    course = get_course_full(conn, course_id)
    if not course:
        conn.close()
        return json_error("Kurs nicht gefunden.", 404)
    candidates = replacement_candidates(conn, course_id)
    conn.close()
    return jsonify({"ok": True, "course": course, "candidates": candidates})


@app.route("/api/studios", methods=["POST"])
@require_auth(["admin"])
def create_studio():
    p = request.get_json(force=True) or {}
    if not p.get("name"):
        return json_error("Name fehlt.")
    conn = get_db()
    cur = conn.execute("INSERT INTO studios (name, address, updated_at) VALUES (?, ?, ?)", (p["name"], p.get("address") or "", now_iso()))
    studio_id = cur.lastrowid
    conn.execute("INSERT INTO rooms (studio_id, name, capacity, updated_at) VALUES (?, ?, ?, ?)", (studio_id, "Kursraum A", 20, now_iso()))
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": studio_id})


@app.route("/api/notifications/read-all", methods=["POST"])
@require_auth(STAFF_ROLES + ["member"])
def mark_all_notifications_read():
    # Same set the user sees in /api/data: the admin all staff messages, everyone else their own.
    role = g.current_user.get("role")
    if role == "admin":
        where, params = "recipient_member_id IS NULL", ()
    elif role == "member":
        where, params = "recipient_member_id = ?", (g.current_user.get("id"),)
    else:
        where, params = "recipient_employee_id = ?", (g.current_user.get("id"),)
    conn = get_db()
    conn.execute(f"UPDATE notifications SET is_read = 1 WHERE is_read = 0 AND {where}", params)
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/notifications/<int:notification_id>/read", methods=["POST"])
@require_auth(STAFF_ROLES + ["member"])
def mark_notification_read(notification_id: int):
    conn = get_db()
    if g.current_user.get("role") != "admin":
        column = "recipient_member_id" if g.current_user.get("role") == "member" else "recipient_employee_id"
        owned = conn.execute(f"SELECT id FROM notifications WHERE id = ? AND {column} = ?", (notification_id, g.current_user.get("id"))).fetchone()
        if not owned:
            conn.close()
            return json_error("Keine Berechtigung für diese Benachrichtigung.", 403)
    conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (notification_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/")
def index():
    return jsonify(
        {
            "message": "Fit & Aktiv Flask API",
            "frontend": "Starten Sie das React-Frontend mit npm run dev und öffnen Sie http://localhost:5173",
            "api": "/api/data",
        }
    )


if __name__ == "__main__":
    init_db(seed=True)
    auto_result = auto_generate_current_year_courses_if_needed()
    if auto_result.get("auto_generated"):
        print(
            f"Automatische Jahreskurse {auto_result['year']}: "
            f"{auto_result['generated_count']} neu, "
            f"{auto_result['skipped_existing']} bereits vorhanden, "
            f"{auto_result['skipped_no_trainer']} ohne Trainer."
        )
    conn = get_db()
    demo_bookings = seed_demo_members(conn)
    seed_demo_ratings(conn)
    seed_demo_attendance(conn)
    seed_demo_cancellations(conn)
    seed_demo_volume(conn)
    seed_demo_trials(conn)
    seed_demo_member_base(conn)
    seed_demo_expenses(conn)
    hash_plaintext_passwords(conn)
    conn.close()
    if demo_bookings:
        print(f"Demo-Mitglieder angelegt: {demo_bookings} Buchungen.")
    # Only reachable from this computer by default; other devices go through the Vite dev server's /api proxy.
    # FITAKTIV_DEBUG=1 turns on the reloader and the interactive debugger (never on a reachable host).
    app.run(
        host=os.environ.get("FITAKTIV_HOST", "127.0.0.1"),
        port=5000,
        debug=os.environ.get("FITAKTIV_DEBUG") == "1",
    )
