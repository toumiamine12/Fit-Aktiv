"""Every test gets its own copy of a freshly seeded demo database (22 studios, 110 staff, 30 members)."""
import os
import shutil
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="fitaktiv-tests-"))
os.environ["FITAKTIV_DB"] = str(_TMP / "fitaktiv.db")  # must be set before the app is imported
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as app_module  # noqa: E402
import database  # noqa: E402

_TEMPLATE = _TMP / "template.db"
database.init_db(seed=True)
_conn = database.get_db()
database.hash_plaintext_passwords(_conn)
_conn.close()
shutil.copy(database.DB_PATH, _TEMPLATE)

ADMIN = "lisa.weber@fit-aktiv.local"
TRAINER = "max.bauer@fit-aktiv.local"
MEMBER = "mitglied01@example.local"
MEMBER_2 = "mitglied02@example.local"
PASSWORD = "pass123"


@pytest.fixture
def client():
    shutil.copy(_TEMPLATE, database.DB_PATH)
    app_module.login_failures.clear()
    return app_module.app.test_client()


@pytest.fixture
def db(client):
    conn = database.get_db()
    yield conn
    conn.close()


def login(client, email, kind="member", password=PASSWORD):
    res = client.post("/api/login", json={"email": email, "password": password, "account_type": kind})
    assert res.status_code == 200, res.get_json()
    return res.get_json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def next_weekday(days_ahead=3):
    d = date.today() + timedelta(days=days_ahead)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()
