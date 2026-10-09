import { useMemo, useState } from "react";
import { api } from "./api.js";
import { formatNumber, mondayOf, shortStudioName, toIsoDate, toLocalDate, todayIso, addDays } from "./format.js";
import StudioMap from "./StudioMap.jsx";
import { FlippingWordSwap } from "@/components/ui/flipping-word-swap";
import { StickyScrollCards } from "@/components/ui/sticky-scroll-cards";
import WeekPlan from "./WeekPlan.jsx";

const COURSE_INFO = {
  Yoga: {
    image: "/images/kurs-yoga.jpg",
    text: "Kraft, Beweglichkeit und Atmung in einer Stunde. Für Einsteiger und Geübte, Matten liegen bereit.",
  },
  Pilates: {
    image: "/images/kurs-pilates.jpg",
    text: "Gezieltes Training für Rumpf, Rücken und Haltung. Ruhig, präzise und gelenkschonend.",
  },
  Spinning: {
    image: "/images/kurs-spinning.jpg",
    text: "Ausdauer auf dem Indoor-Bike, mit Musik und klaren Intervallen. Den Widerstand bestimmen Sie selbst.",
  },
  Krafttraining: {
    image: "/images/kurs-kraft.jpg",
    text: "Saubere Technik an Hantel und Geräten, angeleitet in kleinen Gruppen.",
  },
  "Functional Fit": {
    image: "/images/kurs-functional.jpg",
    text: "Ganzkörpertraining mit eigenem Körpergewicht, Seilen und Kettlebells. Alltagstauglich und abwechslungsreich.",
  },
};

export function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Home({ data, showError, goToLogin }) {
  const [studioId, setStudioId] = useState("all");
  const studios = data.studios || [];
  const courseTypes = data.course_types || [];

  const coursesThisWeek = useMemo(() => {
    const monday = toIsoDate(mondayOf(toLocalDate(todayIso())));
    const friday = toIsoDate(addDays(toLocalDate(monday), 4));
    return (data.courses || []).filter(
      (c) => c.date >= monday && c.date <= friday && c.status !== "cancelled",
    ).length;
  }, [data.courses]);

  function showStudioPlan(id) {
    setStudioId(id);
    scrollToSection("kursplan");
  }

  return (
    <div className="home">
      <section className="hero" id="start">
        <img className="hero-image" src="/images/hero-halle.jpg" alt="" />
        <div className="hero-content">
          <div className="hero-text">
            <h1>
              Hier bleiben Sie{" "}
              <FlippingWordSwap
                word1="fit."
                word2="aktiv."
                className="hero-flip"
                toClassName="text-[var(--gold)]"
              />
            </h1>
            <p>
              {formatNumber(studios.length || 22)} Studios zwischen Geldern und
              Dormagen. Kurse von morgens bis abends, mit Trainerinnen und
              Trainern, die Sie kennen.
            </p>
            <div className="hero-actions">
              <button className="cta" onClick={() => scrollToSection("probetraining")}>
                Probetraining vereinbaren
              </button>
              <button className="ghost-light" onClick={() => scrollToSection("kursplan")}>
                Kursplan ansehen
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section intro" id="ueber-uns">
        <div className="intro-text">
          <h2>Ein Studio in Ihrer Nähe. Ein Team, das mitdenkt.</h2>
          <p>
            Fit &amp; Aktiv ist am Niederrhein zu Hause. Mit Ihrer
            Mitgliedschaft trainieren Sie in allen Studios, buchen Kurse online
            und haben feste Ansprechpartner vor Ort.
          </p>
          <p>
            Ob Sie nach der Arbeit auf das Bike steigen oder morgens Yoga
            machen: Unsere Kurse finden werktags zwischen 8 und 20 Uhr statt,
            in kleinen Gruppen und immer mit Trainer.
          </p>
          <dl className="intro-facts">
            <div>
              <dt>Studios</dt>
              <dd>{formatNumber(studios.length)}</dd>
            </div>
            <div>
              <dt>Kursarten</dt>
              <dd>{formatNumber(courseTypes.length)}</dd>
            </div>
            <div>
              <dt>Kurse diese Woche</dt>
              <dd>{formatNumber(coursesThisWeek)}</dd>
            </div>
          </dl>
        </div>
        <div className="intro-photos">
          <img src="/images/intro-athlet.jpg" alt="Training mit Kurzhantel auf der Trainingsfläche" />
          <img src="/images/intro-studio.jpg" alt="Trainingsbereich eines Fit & Aktiv Studios" />
          <img src="/images/intro-fokus.jpg" alt="Konzentration vor dem nächsten Satz" />
        </div>
      </section>

      <section className="home-section" id="studios">
        <div className="section-head">
          <h2>Unsere Studios</h2>
          <p>Wähle ein Studio auf der Karte oder in der Liste.</p>
        </div>
        <StudioMap
          studios={studios}
          selectedId={studioId}
          onSelect={setStudioId}
          onShowPlan={showStudioPlan}
        />
      </section>

      <section className="home-section" id="kurse">
        <div className="section-head">
          <h2>Unser Kursangebot</h2>
          <p>Alle Kurse dauern 60 Minuten und sind für jedes Level geeignet.</p>
        </div>
        <StickyScrollCards
          cards={courseTypes.map((type) => ({
            title: type.name,
            src: COURSE_INFO[type.name]?.image || "/images/kurs-functional.jpg",
            description:
              COURSE_INFO[type.name]?.text || "Gruppenkurs mit Trainer, 60 Minuten.",
          }))}
        />
      </section>

      <section className="home-section" id="kursplan">
        <div className="section-head">
          <h2>Kursplan</h2>
          <p>
            Hier sehen Sie alle Kurse der Woche.{" "}
            <button className="text-link" onClick={goToLogin}>
              Melden Sie sich an
            </button>
            , um Plätze zu buchen.
          </p>
        </div>
        <WeekPlan
          data={data}
          user={null}
          studioId={studioId}
          onStudioChange={setStudioId}
          showTable={false}
        />
      </section>

      <section className="home-section trial" id="probetraining">
        <TrialForm data={data} showError={showError} preselectedStudioId={studioId} />
      </section>
    </div>
  );
}

function TrialForm({ data, showError, preselectedStudioId }) {
  const emptyForm = {
    name: "",
    email: "",
    phone: "",
    studio_id: "",
    course_type_id: "",
    preferred_date: "",
    message: "",
    consent: false,
  };
  const [form, setForm] = useState(emptyForm);
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const studioId =
    form.studio_id || (preselectedStudioId !== "all" ? String(preselectedStudioId) : "");
  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createTrialRequest({ ...form, studio_id: Number(studioId) });
      const studio = (data.studios || []).find((s) => String(s.id) === studioId);
      setSent({ name: form.name, studio: studio ? shortStudioName(studio.name) : "" });
      setForm(emptyForm);
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="trial-layout">
      <div className="trial-info">
<h2>Probetraining vereinbaren</h2>
        <p>
          Lernen Sie uns kennen, bevor Sie sich entscheiden. Beim Probetraining zeigt
          Ihnen ein Trainer das Studio, Sie sprechen gemeinsam über Ihre Ziele und
          trainieren einmal mit.
        </p>
        <ul>
          <li>kostenlos und unverbindlich</li>
          <li>rund 60 Minuten, mit Trainer</li>
          <li>wir melden uns innerhalb von zwei Werktagen</li>
        </ul>
      </div>
      {sent ? (
        <div className="trial-done" role="status">
          <h3>Vielen Dank, {sent.name}!</h3>
          <p>
            Ihre Anfrage{sent.studio ? ` für ${sent.studio}` : ""} ist bei uns
            angekommen. Wir melden uns per E-Mail oder Telefon, um einen Termin
            zu vereinbaren.
          </p>
          <button className="secondary" onClick={() => setSent(null)}>
            Weitere Anfrage senden
          </button>
        </div>
      ) : (
        <form className="trial-form" onSubmit={submit}>
          <label>
            Name
            <input required autoComplete="name" value={form.name} onChange={set("name")} />
          </label>
          <div className="form-row">
            <label>
              E-Mail
              <input required type="email" autoComplete="email" value={form.email} onChange={set("email")} />
            </label>
            <label>
              <span>Telefon <small>(optional)</small></span>
              <input type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Studio
              <select
                required
                value={studioId}
                onChange={(e) => setForm({ ...form, studio_id: e.target.value })}
              >
                <option value="">Bitte wählen</option>
                {(data.studios || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {shortStudioName(s.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Wunschtermin <small>(optional)</small></span>
              <input type="date" min={todayIso()} value={form.preferred_date} onChange={set("preferred_date")} />
            </label>
          </div>
          <label>
            <span>Interesse an einem Kurs <small>(optional)</small></span>
            <select value={form.course_type_id} onChange={set("course_type_id")}>
              <option value="">Noch offen</option>
              {(data.course_types || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Nachricht <small>(optional)</small></span>
            <textarea rows="3" value={form.message} onChange={set("message")} />
          </label>
          <label className="checkbox">
            <input type="checkbox" required checked={form.consent} onChange={set("consent")} />
            Ich bin einverstanden, dass Fit &amp; Aktiv meine Angaben nutzt, um
            mich wegen des Probetrainings zu kontaktieren.
          </label>
          <button type="submit" className="cta" disabled={busy}>
            {busy ? "Wird gesendet…" : "Anfrage senden"}
          </button>
        </form>
      )}
    </div>
  );
}
