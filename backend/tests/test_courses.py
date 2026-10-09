from conftest import MEMBER, MEMBER_2, TRAINER, auth, login, next_weekday


def add_course(db, type_name, room_id, trainer_id=None, start="10:00"):
    type_id = db.execute("SELECT id FROM course_types WHERE name = ?", (type_name,)).fetchone()["id"]
    cur = db.execute(
        "INSERT INTO courses (course_type_id, date, start_time, room_id, trainer_id) VALUES (?, ?, ?, ?, ?)",
        (type_id, next_weekday(), start, room_id, trainer_id),
    )
    db.commit()
    return cur.lastrowid


def test_full_course_offers_waitlist_and_promotes_on_cancel(client, db):
    db.execute("UPDATE rooms SET capacity = 1 WHERE id = 1")
    db.execute("UPDATE members SET membership_type = 'plus' WHERE email IN (?, ?)", (MEMBER, MEMBER_2))
    course_id = add_course(db, "Yoga", room_id=1)
    first, second = login(client, MEMBER), login(client, MEMBER_2)

    assert client.post(f"/api/courses/{course_id}/booking", headers=auth(first)).status_code == 200
    assert client.post(f"/api/courses/{course_id}/booking", headers=auth(second)).status_code == 409
    joined = client.post(f"/api/courses/{course_id}/waitlist", headers=auth(second))
    assert joined.get_json()["position"] == 1

    cancelled = client.delete(f"/api/courses/{course_id}/booking", headers=auth(first))
    assert cancelled.get_json()["promoted"] is True
    status = db.execute(
        "SELECT b.status FROM bookings b JOIN members m ON m.id = b.member_id WHERE b.course_id = ? AND m.email = ?",
        (course_id, MEMBER_2),
    ).fetchone()["status"]
    assert status == "booked"
    assert db.execute("SELECT 1 FROM email_outbox WHERE to_address = ?", (MEMBER_2,)).fetchone()


def test_sick_trainer_gets_qualified_replacement_or_course_is_cancelled(client, db):
    trainer = db.execute("SELECT * FROM employees WHERE email = ?", (TRAINER,)).fetchone()
    room_id = db.execute("SELECT id FROM rooms WHERE studio_id = ?", (trainer["home_studio_id"],)).fetchone()["id"]
    course_id = add_course(db, "Yoga", room_id, trainer_id=trainer["id"])
    token = login(client, TRAINER, "employee")

    day = next_weekday()
    res = client.post(
        f"/api/employees/{trainer['id']}/absence",
        json={"reason": "Krank", "start_date": day, "end_date": day},
        headers=auth(token),
    )
    assert res.status_code == 200

    course = db.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    assert course["absent_trainer_id"] == trainer["id"]
    if course["status"] == "cancelled":
        assert course["trainer_id"] is None
    else:
        sub = db.execute("SELECT * FROM employees WHERE id = ?", (course["trainer_id"],)).fetchone()
        assert sub["id"] != trainer["id"]
        assert "Yoga" in sub["qualifications"]


def test_revision_changes_when_data_changes(client, db):
    before = client.get("/api/revision").get_json()["revision"]
    add_course(db, "Pilates", room_id=1, start="18:00")
    after = client.get("/api/revision").get_json()["revision"]
    assert before != after
