import re
import time

from werkzeug.security import check_password_hash

import app as app_module
from conftest import ADMIN, MEMBER, PASSWORD, TRAINER, auth, login


def test_stored_passwords_are_hashed(db):
    for table in ("members", "employees"):
        rows = db.execute(f"SELECT password FROM {table}").fetchall()
        assert rows and all(r["password"].startswith("scrypt:") for r in rows)


def test_login_accepts_right_and_rejects_wrong_password(client):
    assert login(client, ADMIN, "employee")
    res = client.post("/api/login", json={"email": ADMIN, "password": "wrong", "account_type": "employee"})
    assert res.status_code == 401


def test_login_is_locked_after_five_failures(client):
    for _ in range(app_module.LOGIN_MAX_FAILURES):
        client.post("/api/login", json={"email": MEMBER, "password": "wrong", "account_type": "member"})
    res = client.post("/api/login", json={"email": MEMBER, "password": PASSWORD, "account_type": "member"})
    assert res.status_code == 429


def test_register_enforces_minimum_and_stores_hash(client, db):
    payload = {"name": "Test Person", "email": "neu@example.local", "home_studio_id": 1}
    assert client.post("/api/members/register", json={**payload, "password": "kurz"}).status_code == 400
    assert client.post("/api/members/register", json={**payload, "password": "langesPasswort"}).status_code == 200
    stored = db.execute("SELECT password FROM members WHERE email = 'neu@example.local'").fetchone()["password"]
    assert stored != "langesPasswort" and check_password_hash(stored, "langesPasswort")


def test_token_expires(client, monkeypatch):
    token = login(client, MEMBER)
    assert client.patch("/api/members/me", json={"name": "Neu"}, headers=auth(token)).status_code == 200
    later = time.time() + app_module.TOKEN_TTL_SECONDS + 60
    monkeypatch.setattr(app_module.time, "time", lambda: later)
    assert client.patch("/api/members/me", json={"name": "Neu"}, headers=auth(token)).status_code == 401


def test_tampered_token_is_rejected(client):
    token = login(client, MEMBER)
    body, sig = token.rsplit(".", 1)
    forged = f"{body}.{'0' * len(sig)}"
    assert client.patch("/api/members/me", json={"name": "X"}, headers=auth(forged)).status_code == 401


def test_password_change_needs_current_password(client):
    token = login(client, MEMBER)
    wrong = {"current_password": "falsch", "new_password": "neuesPasswort1"}
    assert client.patch("/api/members/me", json=wrong, headers=auth(token)).status_code == 403
    right = {"current_password": PASSWORD, "new_password": "neuesPasswort1"}
    assert client.patch("/api/members/me", json=right, headers=auth(token)).status_code == 200
    assert login(client, MEMBER, password="neuesPasswort1")


def test_member_cannot_reach_staff_endpoints(client):
    token = login(client, MEMBER)
    assert client.post("/api/employees", json={}, headers=auth(token)).status_code == 403
    trainer = login(client, TRAINER, "employee")
    assert client.post("/api/employees", json={}, headers=auth(trainer)).status_code == 403


def test_visitors_get_no_staff_data(client):
    data = client.get("/api/data").get_json()
    assert data["employees"] == [] and data["me"] is None


def test_password_reset_flow(client, db):
    assert client.post("/api/password-reset", json={"email": MEMBER, "account_type": "member"}).status_code == 200
    mail = db.execute("SELECT body FROM email_outbox WHERE to_address = ? ORDER BY id DESC", (MEMBER,)).fetchone()
    token = re.search(r"\?reset=([\w-]+)", mail["body"]).group(1)

    confirm = lambda pw: client.post("/api/password-reset/confirm", json={"token": token, "password": pw})
    assert confirm("kurz").status_code == 400
    assert confirm("ganzNeuesPasswort").status_code == 200
    assert login(client, MEMBER, password="ganzNeuesPasswort")
    assert confirm("nochmalNeu123").status_code == 400  # the link only works once


def test_password_reset_does_not_reveal_unknown_accounts(client, db):
    before = db.execute("SELECT COUNT(*) FROM email_outbox").fetchone()[0]
    res = client.post("/api/password-reset", json={"email": "gibtsnicht@example.local", "account_type": "member"})
    assert res.status_code == 200
    assert db.execute("SELECT COUNT(*) FROM email_outbox").fetchone()[0] == before
