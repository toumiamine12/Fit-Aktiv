// Calendar export: a single course as an .ics file (works with Google, Apple and Outlook calendars).

function icsText(text = "") {
  return text.replace(/[\\,;]/g, (ch) => `\\${ch}`).replace(/\n/g, "\\n");
}

function icsTime(date, time, plusMinutes = 0) {
  const d = new Date(`${date}T${time}:00`);
  d.setMinutes(d.getMinutes() + plusMinutes);
  const pad = (n) => String(n).padStart(2, "0");
  // Floating local time: the event shows at the same clock time on the member's device.
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function vevent(course, stamp) {
  return [
    "BEGIN:VEVENT",
    `UID:kurs-${course.id}@fit-aktiv.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsTime(course.date, course.start_time)}`,
    `DTEND:${icsTime(course.date, course.start_time, course.duration_minutes || 60)}`,
    `SUMMARY:${icsText(`${course.course_type_name} bei Fit & Aktiv`)}`,
    `LOCATION:${icsText(`${course.studio_name}, ${course.room_name}`)}`,
    `DESCRIPTION:${icsText(course.trainer_name ? `Trainer: ${course.trainer_name}` : "Fit & Aktiv Kurs")}`,
    "END:VEVENT",
  ];
}

/** One .ics file with all given courses; calendars import every event at once. */
export function downloadCoursesIcs(courses, filename) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fit & Aktiv//Kursplan//DE",
    "X-WR-CALNAME:Fit & Aktiv Kurse",
    ...courses.flatMap((c) => vevent(c, stamp)),
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadCourseIcs(course) {
  downloadCoursesIcs([course], `${course.course_type_name}-${course.date}.ics`.replace(/\s+/g, "-"));
}
