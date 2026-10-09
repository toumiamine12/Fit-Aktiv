export function isAdmin(user) {
  return user?.role === "admin";
}

export function isOwnAbsentCourse(course, user) {
  return Boolean(
    user?.id &&
      course?.absent_trainer_id &&
      String(course.absent_trainer_id) === String(user.id),
  );
}

export function hasAbsentTrainer(course) {
  return Boolean(course?.absent_trainer_id);
}

export function courseRowClass(course, user) {
  if (isOwnAbsentCourse(course, user)) return "sick-row";
  if (course.status === "cancelled") return "cancelled-row";
  if (course.status !== "active") return "attention";
  return "";
}

export function CourseStatusBadge({ course, user }) {
  if (isOwnAbsentCourse(course, user)) {
    return <span className="badge red">krank</span>;
  }
  return <StatusBadge status={course.status} />;
}

export function trainerCell(course, user) {
  const trainer = course.trainer_name || <em>kein Trainer</em>;
  if (isOwnAbsentCourse(course, user)) {
    return (
      <>
        {trainer}
        <small className="block sick-text">Ihre Schicht: krank</small>
      </>
    );
  }
  if (hasAbsentTrainer(course)) {
    return (
      <>
        {trainer}
        <small className="block sick-text">krank: {course.absent_trainer_name}</small>
      </>
    );
  }
  return trainer;
}

export function StatusBadge({ status }) {
  const cls =
    status === "active" || status === "available"
      ? "green"
      : status === "needs_replacement"
        ? "orange"
        : "red";
  const text =
    {
      active: "aktiv",
      available: "verfügbar",
      unavailable: "nicht verfügbar",
      needs_replacement: "Ersatz nötig",
      cancelled: "ausgefallen",
    }[status] || status;
  return <span className={`badge ${cls}`}>{text}</span>;
}

export function courseColorClass(course, user) {
  if (isOwnAbsentCourse(course, user)) return "course-sick";
  if (course.status === "cancelled") return "course-cancelled";
  if (course.status === "needs_replacement") return "course-warning";
  const name = (course.course_type_name || "").toLowerCase();
  if (name.includes("yoga")) return "course-yoga";
  if (name.includes("pilates")) return "course-pilates";
  if (name.includes("spinning")) return "course-spinning";
  if (name.includes("kraft")) return "course-kraft";
  if (name.includes("functional")) return "course-functional";
  return "course-neutral";
}

export function isMember(user) {
  return user?.role === "member";
}
