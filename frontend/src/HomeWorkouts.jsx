import { useEffect, useState } from "react";
import { Dumbbell, Flower2, HeartPulse, Pause, Play, SkipForward, StretchHorizontal, Target, X } from "lucide-react";

const CATEGORIES = {
  kraft: { label: "Kraft", Icon: Dumbbell },
  core: { label: "Bauch & Core", Icon: Target },
  cardio: { label: "Cardio", Icon: HeartPulse },
  mobil: { label: "Mobilität", Icon: StretchHorizontal },
  ruhe: { label: "Entspannung", Icon: Flower2 },
};

// Exercises without equipment (a mat, at most a chair). Each has two photos, start and end
// position, from the public-domain Free Exercise DB; they alternate to show the movement.
const EXERCISES = [
  {
    id: "squat", name: "Kniebeuge", category: "kraft", level: "Einsteiger", dose: "3 × 15", muscles: "Beine, Po",
    steps: ["Füße schulterbreit, Hände am Hinterkopf.", "Hüfte nach hinten und unten schieben.", "So tief gehen, wie der Rücken gerade bleibt.", "Über die Fersen kraftvoll hochdrücken."],
    tip: "Brust bleibt oben, Knie zeigen nach außen.",
  },
  {
    id: "pushup", name: "Liegestütz", category: "kraft", level: "Einsteiger", dose: "3 × 10", muscles: "Brust, Schultern, Arme",
    steps: ["Hände etwas breiter als die Schultern.", "Körper bildet eine Linie von Kopf bis Fuß.", "Brust kontrolliert zum Boden senken.", "Ausatmen und hochdrücken."],
    tip: "Zu schwer? Legen Sie die Knie ab.",
  },
  {
    id: "lunge", name: "Ausfallschritt gehend", category: "kraft", level: "Einsteiger", dose: "3 × 10 pro Bein", muscles: "Beine, Po, Rumpf",
    steps: ["Aufrecht stehen, großer Schritt nach vorne.", "Hinteres Knie Richtung Boden senken.", "Mit dem hinteren Bein nach vorne durchsteigen.", "Abwechselnd weitergehen."],
    tip: "Das vordere Knie bleibt über dem Fuß.",
  },
  {
    id: "splitsquat", name: "Split Squat", category: "kraft", level: "Einsteiger", dose: "3 × 12 pro Bein", muscles: "Oberschenkel, Po",
    steps: ["Schrittstellung, Füße hüftbreit versetzt.", "Gewicht auf das vordere Bein.", "Gerade nach unten sinken, bis beide Knie gebeugt sind.", "Hochdrücken, nach allen Wiederholungen Seite wechseln."],
    tip: "Die Füße bleiben die ganze Zeit am Boden.",
  },
  {
    id: "bridge", name: "Beckenheben", category: "kraft", level: "Einsteiger", dose: "3 × 15", muscles: "Po, unterer Rücken",
    steps: ["Rückenlage, Füße aufgestellt.", "Po anspannen und Becken anheben.", "Oben kurz halten, Schultern bis Knie in einer Linie.", "Langsam ablegen."],
    tip: "Über die Fersen drücken, nicht über die Zehen.",
  },
  {
    id: "bridge1", name: "Einbeiniges Beckenheben", category: "kraft", level: "Fortgeschritten", dose: "3 × 10 pro Bein", muscles: "Po, Beinrückseite",
    steps: ["Rückenlage, ein Fuß aufgestellt, das andere Bein gestreckt.", "Becken über das Standbein anheben.", "Oben halten, Becken bleibt gerade.", "Ablegen und nach dem Satz wechseln."],
    tip: "Das Becken kippt nicht zur Seite.",
  },
  {
    id: "dips", name: "Dips am Stuhl", category: "kraft", level: "Einsteiger", dose: "3 × 10", muscles: "Trizeps, Schultern",
    steps: ["Hände hinter dem Körper auf eine stabile Stuhlkante.", "Beine nach vorne strecken.", "Ellbogen nach hinten beugen und absenken.", "Über die Handballen hochdrücken."],
    tip: "Schultern bleiben weg von den Ohren.",
  },
  {
    id: "kickback", name: "Glute Kickback", category: "kraft", level: "Einsteiger", dose: "3 × 12 pro Bein", muscles: "Po",
    steps: ["Vierfüßlerstand auf den Unterarmen.", "Ein Knie Richtung Brust ziehen.", "Bein kraftvoll nach hinten oben strecken.", "Kontrolliert zurück, nach dem Satz wechseln."],
    tip: "Kein Hohlkreuz: Bauch bleibt fest.",
  },
  {
    id: "pushside", name: "Liegestütz mit Seitstütz", category: "kraft", level: "Fortgeschritten", dose: "3 × 8", muscles: "Brust, Schultern, Rumpf",
    steps: ["Normale Liegestütz ausführen.", "Oben angekommen auf eine Seite drehen.", "Arm zur Decke strecken, kurz halten.", "Zurückdrehen und Seite wechseln."],
    tip: "Hüfte bleibt beim Drehen oben.",
  },
  {
    id: "plank", name: "Unterarmstütz", category: "core", level: "Einsteiger", dose: "3 × 30 Sekunden", muscles: "Bauch, Rücken",
    steps: ["Unterarme unter die Schultern.", "Beine strecken, Körper bildet eine Linie.", "Bauch und Po fest anspannen.", "Ruhig atmen und halten."],
    tip: "Hüfte weder durchhängen lassen noch hochschieben.",
  },
  {
    id: "crunch", name: "Crunch", category: "core", level: "Einsteiger", dose: "3 × 15", muscles: "Gerader Bauchmuskel",
    steps: ["Rückenlage, Füße aufgestellt, Hände an den Schläfen.", "Schulterblätter vom Boden abheben.", "Oben kurz halten.", "Langsam zurück."],
    tip: "Nicht am Kopf ziehen, Blick zur Decke.",
  },
  {
    id: "crosscrunch", name: "Diagonal-Crunch", category: "core", level: "Einsteiger", dose: "3 × 12 pro Seite", muscles: "Schräge Bauchmuskeln",
    steps: ["Rückenlage, Beine angehoben.", "Ellbogen diagonal zum gegenüberliegenden Knie führen.", "Das andere Bein strecken.", "Seiten im Wechsel."],
    tip: "Die Drehung kommt aus dem Oberkörper.",
  },
  {
    id: "revcrunch", name: "Reverse Crunch", category: "core", level: "Einsteiger", dose: "3 × 12", muscles: "Unterer Bauch",
    steps: ["Rückenlage, Arme neben dem Körper.", "Beine angewinkelt anheben.", "Becken einrollen und vom Boden heben.", "Langsam abrollen."],
    tip: "Ohne Schwung, nur aus dem Bauch.",
  },
  {
    id: "deadbug", name: "Dead Bug", category: "core", level: "Einsteiger", dose: "3 × 10 pro Seite", muscles: "Tiefe Bauchmuskeln",
    steps: ["Rückenlage, Arme und Beine angewinkelt nach oben.", "Unterer Rücken drückt in den Boden.", "Gegenüberliegenden Arm und Bein langsam strecken.", "Zurück und Seite wechseln."],
    tip: "Langsam ist hier schwerer und besser.",
  },
  {
    id: "sideplank", name: "Seitstütz", category: "core", level: "Fortgeschritten", dose: "3 × 20 Sekunden pro Seite", muscles: "Seitlicher Bauch, Hüfte",
    steps: ["Seitlage, Unterarm unter der Schulter.", "Becken anheben, Körper bildet eine Linie.", "Halten und ruhig atmen.", "Ablegen und Seite wechseln."],
    tip: "Hüfte nach vorne schieben, nicht nach hinten kippen.",
  },
  {
    id: "superman", name: "Superman", category: "core", level: "Einsteiger", dose: "3 × 12", muscles: "Rücken, Po",
    steps: ["Bauchlage, Arme lang nach vorne.", "Arme, Brust und Beine gleichzeitig anheben.", "Zwei Sekunden halten.", "Langsam ablegen."],
    tip: "Blick bleibt zum Boden, der Nacken lang.",
  },
  {
    id: "jumping", name: "Hampelmann-Sprung", category: "cardio", level: "Einsteiger", dose: "3 × 40 Sekunden", muscles: "Ganzkörper, Ausdauer",
    steps: ["Leicht in die Hocke gehen.", "Explosiv abspringen, Arme und Beine weit öffnen.", "Weich in der Hocke landen.", "Sofort weiter."],
    tip: "Leise landen, über den Vorfuß abfedern.",
  },
  {
    id: "climber", name: "Mountain Climber", category: "cardio", level: "Einsteiger", dose: "3 × 30 Sekunden", muscles: "Bauch, Beine, Ausdauer",
    steps: ["Hohe Stützposition wie beim Liegestütz.", "Ein Knie zügig Richtung Brust ziehen.", "Beine schnell im Wechsel tauschen.", "Hüfte bleibt tief."],
    tip: "Erst sauber, dann schneller.",
  },
  {
    id: "jumpsquat", name: "Sprungkniebeuge", category: "cardio", level: "Fortgeschritten", dose: "3 × 12", muscles: "Beine, Po, Ausdauer",
    steps: ["Tiefe Kniebeuge.", "Explosiv nach oben abspringen.", "Weich landen und direkt in die nächste Kniebeuge.", "Rhythmus halten."],
    tip: "Knie zeigen auch bei der Landung nach außen.",
  },
  {
    id: "splitjump", name: "Ausfallschritt-Sprung", category: "cardio", level: "Fortgeschritten", dose: "3 × 10 pro Seite", muscles: "Beine, Po, Ausdauer",
    steps: ["Ausfallschritt-Position.", "Kraftvoll nach oben abspringen.", "In der Luft die Beine wechseln.", "Weich im Ausfallschritt landen."],
    tip: "Arme schwingen gegengleich mit.",
  },
  {
    id: "tuckjump", name: "Hocksprung", category: "cardio", level: "Fortgeschritten", dose: "3 × 10", muscles: "Beine, Bauch, Sprungkraft",
    steps: ["Hüftbreit stehen, leicht in die Knie.", "Hoch abspringen.", "Knie in der Luft zur Brust ziehen.", "Weich landen und sofort weiter."],
    tip: "Kurze Bodenkontakte, wie ein Flummi.",
  },
  {
    id: "cat", name: "Katze-Kuh", category: "mobil", level: "Alle", dose: "10 langsame Wiederholungen", muscles: "Wirbelsäule, Rücken",
    steps: ["Vierfüßlerstand, Hände unter den Schultern.", "Ausatmen: Rücken rund machen.", "Einatmen: Rücken sinken lassen, Blick nach vorne.", "Fließend wechseln."],
    tip: "Ideal nach langem Sitzen.",
  },
  {
    id: "hip", name: "Hüftbeuger-Dehnung", category: "mobil", level: "Alle", dose: "2 × 30 Sekunden pro Seite", muscles: "Hüfte, Oberschenkel",
    steps: ["Kniestand, ein Bein nach vorne aufstellen.", "Becken langsam nach vorne schieben.", "Dehnung vorne an der Hüfte spüren.", "Halten, dann Seite wechseln."],
    tip: "Po anspannen verstärkt die Dehnung.",
  },
  {
    id: "wgs", name: "World's Greatest Stretch", category: "mobil", level: "Fortgeschritten", dose: "5 pro Seite", muscles: "Hüfte, Beinrückseite, Brustwirbelsäule",
    steps: ["Tiefer Ausfallschritt, Hände neben den vorderen Fuß.", "Ellbogen Richtung Boden sinken lassen.", "Vorderes Bein strecken, Hüfte nach hinten.", "Zurück und Seite wechseln."],
    tip: "Die beste Einzelübung zum Aufwärmen.",
  },
  {
    id: "inchworm", name: "Inchworm", category: "mobil", level: "Einsteiger", dose: "8 Wiederholungen", muscles: "Beinrückseite, Schultern",
    steps: ["Aus dem Stand nach vorne beugen, Hände zum Boden.", "Mit den Händen nach vorne in den Stütz laufen.", "Kurz halten.", "Mit kleinen Schritten zurück zu den Händen."],
    tip: "Die Knie dürfen leicht gebeugt sein.",
  },
  {
    id: "armcircles", name: "Armkreisen", category: "mobil", level: "Alle", dose: "2 × 20 Sekunden pro Richtung", muscles: "Schultern",
    steps: ["Aufrecht stehen, Arme seitlich gestreckt.", "Kleine Kreise nach vorne.", "Kreise langsam größer werden lassen.", "Richtung wechseln."],
    tip: "Perfekt vor Liegestützen.",
  },
  {
    id: "child", name: "Kindhaltung", category: "ruhe", level: "Alle", dose: "1 bis 2 Minuten", muscles: "Rücken, Hüfte",
    steps: ["Auf die Fersen setzen, Knie etwas geöffnet.", "Oberkörper nach vorne ablegen.", "Arme lang nach vorne oder neben den Körper.", "Tief in den Rücken atmen."],
    tip: "Ein Kissen unter der Stirn macht es bequemer.",
  },
  {
    id: "kneeschest", name: "Knie zur Brust", category: "ruhe", level: "Alle", dose: "1 Minute", muscles: "Unterer Rücken",
    steps: ["Rückenlage.", "Beide Knie zur Brust ziehen.", "Mit den Armen umfassen.", "Sanft hin und her schaukeln."],
    tip: "Entspannt den unteren Rücken nach dem Training.",
  },
  {
    id: "breath", name: "Box-Atmung", category: "ruhe", level: "Alle", dose: "5 Minuten", muscles: "Entspannung, Fokus", still: true,
    steps: ["Bequem sitzen, Augen schließen.", "4 Sekunden einatmen.", "4 Sekunden halten, 4 Sekunden ausatmen.", "4 Sekunden halten und wiederholen."],
    tip: "Hilft vor dem Schlafen und bei Stress.",
  },
];

// Guided routines: exercises with work and rest time in seconds.
const ROUTINES = [
  {
    id: "ganzkoerper", name: "10 Minuten Ganzkörper", text: "Kraft und Puls für zwischendurch, ohne Geräte.",
    work: 40, rest: 20, rounds: 2, exercises: ["squat", "pushup", "lunge", "plank", "jumping"],
  },
  {
    id: "core", name: "Bauch & Core", text: "Ein starker Rumpf für einen gesunden Rücken.",
    work: 40, rest: 20, rounds: 2, exercises: ["crunch", "deadbug", "revcrunch", "sideplank", "superman"],
  },
  {
    id: "po", name: "Beine & Po", text: "Unterkörper komplett, ganz ohne Geräte.",
    work: 40, rest: 20, rounds: 2, exercises: ["squat", "bridge", "splitsquat", "kickback", "bridge1"],
  },
  {
    id: "hiit", name: "HIIT Cardio", text: "Kurz und intensiv: 20 Sekunden Pause zwischen den Runden.",
    work: 30, rest: 20, rounds: 3, exercises: ["jumping", "climber", "jumpsquat", "splitjump"],
  },
  {
    id: "ruecken", name: "Rücken und Mobilität", text: "Sanft für Büro-Tage: löst Verspannungen in Rücken und Hüfte.",
    work: 45, rest: 15, rounds: 2, exercises: ["cat", "hip", "wgs", "child"],
  },
];

/** Start and end position alternate like a GIF; still photo for exercises without movement. */
function ExercisePhoto({ exercise, large = false, rest = false, playing = true }) {
  const base = `/images/uebungen/${exercise.id}`;
  return (
    <div className={`exercise-photo ${large ? "large" : ""} ${rest ? "rest" : ""} ${playing ? "" : "paused"}`}>
      {!playing && !exercise.still && (
        <span className="exercise-play" aria-hidden="true">
          <Play size={16} fill="currentColor" />
        </span>
      )}
      {exercise.still ? (
        <img src={`${base}.jpg`} alt={exercise.name} loading="lazy" />
      ) : (
        <>
          <img src={`${base}-0.jpg`} alt={`${exercise.name}: Startposition`} loading="lazy" />
          <img className="exercise-photo-end" src={`${base}-1.jpg`} alt={`${exercise.name}: Endposition`} loading="lazy" />
        </>
      )}
    </div>
  );
}

/** Opened exercise: the movement plays large, with dose, muscles, steps and tip. */
function ExerciseDetail({ exercise, onClose }) {
  const { Icon, label } = CATEGORIES[exercise.category];
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal exercise-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <ExercisePhoto exercise={exercise} large />
        <div className="exercise-detail-body">
          <div className={`exercise-head cat-${exercise.category}`}>
            <span className="exercise-icon" aria-hidden="true">
              <Icon size={22} />
            </span>
            <div>
              <h2 id="exercise-detail-title">{exercise.name}</h2>
              <small>
                {label}, {exercise.level}
              </small>
            </div>
          </div>
          <dl className="exercise-detail-facts">
            <div>
              <dt>Umfang</dt>
              <dd>{exercise.dose}</dd>
            </div>
            <div>
              <dt>Trainiert</dt>
              <dd>{exercise.muscles}</dd>
            </div>
          </dl>
          <h3>So geht's</h3>
          <ol>
            {exercise.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="exercise-tip">{exercise.tip}</p>
          <div className="modal-actions">
            <button className="secondary" onClick={onClose} autoFocus>
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const byId = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Sound is optional.
  }
}

function buildSteps(routine) {
  const steps = [];
  for (let round = 1; round <= routine.rounds; round += 1) {
    routine.exercises.forEach((id, i) => {
      steps.push({ kind: "work", exercise: byId[id], seconds: routine.work, round });
      const last = round === routine.rounds && i === routine.exercises.length - 1;
      if (!last) steps.push({ kind: "rest", seconds: routine.rest, round });
    });
  }
  return steps;
}

function Timer({ routine, onClose }) {
  const [steps] = useState(() => buildSteps(routine));
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(steps[0].seconds);
  const [running, setRunning] = useState(true);
  const done = index >= steps.length;

  // One tick per second; reaching zero moves on to the next step.
  useEffect(() => {
    if (!running || done) return undefined;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [running, done]);

  useEffect(() => {
    if (left > 0 || done) return;
    beep();
    const next = index + 1;
    setIndex(next);
    setLeft(next < steps.length ? steps[next].seconds : 0);
    // Only the countdown reaching zero should move on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const step = steps[Math.min(index, steps.length - 1)];
  const upcoming = steps.slice(index + 1).find((s) => s.kind === "work");
  const total = steps.reduce((sum, s) => sum + s.seconds, 0);
  const elapsed = steps.slice(0, index).reduce((sum, s) => sum + s.seconds, 0) + (step.seconds - left);

  const skip = () => {
    const next = index + 1;
    setIndex(next);
    setLeft(next < steps.length ? steps[next].seconds : 0);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal workout-timer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="workout-timer-head">
          <span>{routine.name}</span>
          <button className="ghost icon-button" onClick={onClose} aria-label="Workout beenden">
            <X size={18} />
          </button>
        </div>
        {done ? (
          <div className="workout-done">
            <h2>Geschafft!</h2>
            <p>{Math.round(total / 60)} Minuten Training. Gönnen Sie sich ein Glas Wasser.</p>
            <button onClick={onClose}>Schließen</button>
          </div>
        ) : (
          <>
            <p className="workout-phase">
              {step.kind === "work" ? `Runde ${step.round} von ${routine.rounds}` : "Pause"}
            </p>
            <h2>{step.kind === "work" ? step.exercise.name : "Durchatmen"}</h2>
            {step.kind === "work" ? (
              <ExercisePhoto key={step.exercise.id} exercise={step.exercise} large />
            ) : (
              upcoming && <ExercisePhoto key={`next-${upcoming.exercise.id}`} exercise={upcoming.exercise} large rest />
            )}
            <div className={`workout-count ${step.kind}`} aria-live="polite">
              {left}
            </div>
            {step.kind === "work" && <p className="workout-tip">{step.exercise.tip}</p>}
            {upcoming && <p className="muted">Als Nächstes: {upcoming.exercise.name}</p>}
            <div className="occupancy-bar">
              <span style={{ width: `${(elapsed / total) * 100}%` }} />
            </div>
            <div className="workout-controls">
              <button className="secondary" onClick={() => setRunning(!running)}>
                {running ? <Pause size={16} /> : <Play size={16} />} {running ? "Pause" : "Weiter"}
              </button>
              <button className="secondary" onClick={skip}>
                <SkipForward size={16} /> Überspringen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Bonus for members: exercise guides and guided routines for training at home. */
export default function HomeWorkouts() {
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState(null);
  const [routine, setRoutine] = useState(null);
  const shown = EXERCISES.filter((e) => category === "all" || e.category === category);

  return (
    <section className="home-workouts">
      <p className="home-workouts-intro">
        Kein Studio in der Nähe oder wenig Zeit? Diese Übungen brauchen nur eine Matte. Starten Sie ein geführtes Workout mit
        Timer oder sehen Sie sich einzelne Übungen an.
      </p>

      <div className="routine-grid">
        {ROUTINES.map((r) => {
          const minutes = Math.round(((r.work + r.rest) * r.exercises.length * r.rounds - r.rest) / 60);
          return (
            <article key={r.id} className="routine-card">
              <span className="routine-time">{minutes} Min.</span>
              <h3>{r.name}</h3>
              <p>{r.text}</p>
              <small>
                {r.rounds} Runden, {r.work} s Übung, {r.rest} s Pause
              </small>
              <button onClick={() => setRoutine(r)}>
                <Play size={16} /> Workout starten
              </button>
            </article>
          );
        })}
      </div>

      <div className="exercise-filter" role="tablist" aria-label="Kategorie">
        {[["all", "Alle"], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={category === key}
            className={`studio-chip ${category === key ? "active" : ""}`}
            onClick={() => setCategory(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="exercise-grid">
        {shown.map((e) => {
          const { Icon, label } = CATEGORIES[e.category];
          return (
            <article
              key={e.id}
              className={`exercise-card cat-${e.category}`}
              role="button"
              tabIndex={0}
              aria-label={`${e.name} ansehen`}
              onClick={() => setOpen(e.id)}
              onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setOpen(e.id))}
            >
              <ExercisePhoto exercise={e} playing={false} />
              <div className="exercise-head">
                <span className="exercise-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <div>
                  <h3>{e.name}</h3>
                  <small>
                    {label}, {e.level}
                  </small>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Umfang</dt>
                  <dd>{e.dose}</dd>
                </div>
                <div>
                  <dt>Trainiert</dt>
                  <dd>{e.muscles}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      {open && <ExerciseDetail exercise={byId[open]} onClose={() => setOpen(null)} />}
      {routine && <Timer routine={routine} onClose={() => setRoutine(null)} />}
    </section>
  );
}
