import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff, Check, X } from "lucide-react";
import { api } from "./api.js";
import { isAdmin } from "./courses.jsx";
import { shortStudioName } from "./format.js";

const PLANS = { basic: "Basic", plus: "Plus", premium: "Premium", young: "Young" };
const SCAN_PAUSE_MS = 2000; // one card is read once, not every frame while it is held up

/** Camera that reads membership QR codes and reports each code once. */
function Scanner({ onCode }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const pausedUntil = useRef(0);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState("off"); // off | starting | on | denied

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState("off");
  }, []);

  useEffect(() => stop, [stop]);

  function scan() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA && Date.now() > pausedUntil.current) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (hit?.data) {
        pausedUntil.current = Date.now() + SCAN_PAUSE_MS;
        onCodeRef.current(hit.data);
      }
    }
    frameRef.current = requestAnimationFrame(scan);
  }

  async function start() {
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setState("on");
      frameRef.current = requestAnimationFrame(scan);
    } catch {
      setState("denied");
    }
  }

  return (
    <div className="attendance-scanner">
      <div className={`checkin-camera ${state}`}>
        <video ref={videoRef} muted playsInline />
        <canvas ref={canvasRef} hidden />
        {state === "on" ? (
          <span className="checkin-frame" aria-hidden="true" />
        ) : (
          <div className="checkin-camera-idle">
            <p>
              {state === "denied"
                ? "Kein Zugriff auf die Kamera. Bitte unten in der Liste abhaken."
                : "Starten Sie die Kamera und scannen Sie die Mitgliedskarten der Teilnehmer."}
            </p>
          </div>
        )}
      </div>
      {state === "on" ? (
        <button className="secondary" onClick={stop}>
          <CameraOff size={16} /> Kamera aus
        </button>
      ) : (
        <button onClick={start} disabled={state === "starting"}>
          <Camera size={16} /> {state === "starting" ? "Kamera startet…" : "Mitgliedskarten scannen"}
        </button>
      )}
    </div>
  );
}

/** The coach checks in who came to today's sessions; the counts show how many came and who. */
export default function Attendance({ data, user, showError }) {
  const admin = isAdmin(user);
  const [studioId, setStudioId] = useState(user.home_studio_id || data.studios?.[0]?.id);
  const [courses, setCourses] = useState(null);
  const [courseId, setCourseId] = useState(null);
  const [list, setList] = useState(null);
  const [last, setLast] = useState(null);

  const loadCourses = useCallback(async () => {
    try {
      const res = await api.attendanceToday(admin ? studioId : undefined);
      setCourses(res.courses);
      setCourseId((current) => (res.courses.some((c) => c.id === current) ? current : res.courses[0]?.id ?? null));
    } catch (err) {
      showError(err.message);
    }
  }, [admin, studioId, showError]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    setLast(null);
    if (!courseId) return setList(null);
    api
      .courseAttendance(courseId)
      .then((res) => setList(res.participants))
      .catch((err) => showError(err.message));
  }, [courseId, showError]);

  async function toggle(person) {
    const attended = !person.attended;
    setList((l) => l.map((p) => (p.booking_id === person.booking_id ? { ...p, attended: attended ? 1 : 0 } : p)));
    setCourses((cs) => cs.map((c) => (c.id === courseId ? { ...c, present: c.present + (attended ? 1 : -1) } : c)));
    try {
      await api.setAttendance(courseId, person.booking_id, attended);
    } catch (err) {
      showError(err.message);
      loadCourses();
    }
  }

  async function scanned(code) {
    try {
      const res = await api.scanMember(courseId, code);
      setLast({ ok: true, text: res.already ? `${res.name} ist bereits eingecheckt.` : `${res.name} eingecheckt.` });
      if (!res.already) {
        setList((l) => l.map((p) => (p.booking_id === res.booking_id ? { ...p, attended: 1 } : p)));
        setCourses((cs) => cs.map((c) => (c.id === courseId ? { ...c, present: c.present + 1 } : c)));
      }
    } catch (err) {
      setLast({ ok: false, text: err.message });
    }
  }

  const course = courses?.find((c) => c.id === courseId);
  const present = list?.filter((p) => p.attended).length ?? 0;

  return (
    <section className="attendance-page">
      <div className="panel attendance-courses">
        <div className="profile-box-head">
          <h2>{admin ? "Kurse heute" : "Ihre Kurse heute"}</h2>
          {admin && (
            <select value={studioId} onChange={(e) => setStudioId(Number(e.target.value))} aria-label="Studio">
              {(data.studios || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {shortStudioName(s.name)}
                </option>
              ))}
            </select>
          )}
        </div>
        {courses === null ? (
          <p className="muted">Wird geladen.</p>
        ) : courses.length === 0 ? (
          <p className="muted">Heute stehen keine Kurse an.</p>
        ) : (
          <ul>
            {courses.map((c) => (
              <li key={c.id}>
                <button className={`attendance-course ${c.id === courseId ? "active" : ""}`} onClick={() => setCourseId(c.id)}>
                  <span className="attendance-time">{c.start_time}</span>
                  <span>
                    <strong>{c.course_type_name}</strong>
                    <small>{admin ? c.trainer_name : `${shortStudioName(c.studio_name)}, ${c.room_name}`}</small>
                  </span>
                  <span className="attendance-count">
                    {c.present}/{c.booked}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel attendance-list">
        {course && list ? (
          <>
            <div className="profile-box-head">
              <h2>
                {course.course_type_name}, {course.start_time} Uhr
              </h2>
              <span className="muted">{course.room_name}</span>
            </div>
            <Scanner onCode={scanned} />
            {last && (
              <p className={`attendance-last ${last.ok ? "ok" : "denied"}`} role="status">
                {last.ok ? <Check size={18} /> : <X size={18} />} {last.text}
              </p>
            )}
            <p className="attendance-summary">
              <strong>{present}</strong> von {list.length} angemeldeten Mitgliedern sind da
            </p>
            {list.length ? (
              <ul>
                {list.map((p) => (
                  <li key={p.booking_id}>
                    <label className={`attendance-person ${p.attended ? "present" : ""}`}>
                      <input type="checkbox" checked={Boolean(p.attended)} onChange={() => toggle(p)} />
                      <span>
                        {p.name}
                        <small>
                          FA-{String(p.member_id).padStart(6, "0")}, {PLANS[p.membership_type] || p.membership_type}
                        </small>
                      </span>
                      <em>{p.attended ? "anwesend" : "noch nicht da"}</em>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Für diesen Kurs hat niemand gebucht.</p>
            )}
          </>
        ) : (
          <p className="muted">Wählen Sie links einen Kurs, um die Teilnehmer einzuchecken.</p>
        )}
      </div>
    </section>
  );
}
