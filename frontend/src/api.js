// Relative: the Vite dev server forwards /api to the Flask backend (see vite.config.js).
const API_BASE = '/api'

export function getStoredAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem('fitaktiv_auth'))
    if (auth?.user && auth?.token) return auth
  } catch {}
  return null
}

export function setStoredAuth(auth) {
  if (!auth) {
    localStorage.removeItem('fitaktiv_auth')
    localStorage.removeItem('fitaktiv_user')
    return
  }
  localStorage.setItem('fitaktiv_auth', JSON.stringify(auth))
}

async function request(path, options = {}) {
  const auth = getStoredAuth()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && auth?.token) {
    // Token expired or invalid: drop the session and show the login again.
    setStoredAuth(null)
    window.location.reload()
  }
  if (!res.ok || data.ok === false) {
    // A list of reasons belongs in the message; a details object (e.g. the member at a refused check-in) travels on the error.
    const detail = Array.isArray(data.details) ? ` ${data.details.join(' ')}` : ''
    const error = new Error(`${data.error || 'API Fehler'}${detail}`)
    if (data.details && !Array.isArray(data.details)) error.details = data.details
    throw error
  }
  return data
}

export const api = {
  getData: () => request('/data'),
  login: (email, password, account_type = 'employee') =>
    request('/login', { method: 'POST', body: JSON.stringify({ email, password, account_type }) }),
  registerMember: (payload) => request('/members/register', { method: 'POST', body: JSON.stringify(payload) }),
  updateOwnProfile: (payload) => request('/members/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  updateEmployeeProfile: (payload) => request('/employees/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  getParticipants: (id) => request(`/courses/${id}/participants`),
  bookCourse: (id) => request(`/courses/${id}/booking`, { method: 'POST' }),
  cancelBooking: (id) => request(`/courses/${id}/booking`, { method: 'DELETE' }),
  joinWaitlist: (id) => request(`/courses/${id}/waitlist`, { method: 'POST' }),
  leaveWaitlist: (id) => request(`/courses/${id}/waitlist`, { method: 'DELETE' }),
  setFavorite: (kind, targetId, on) => request('/members/me/favorites', { method: on ? 'POST' : 'DELETE', body: JSON.stringify({ kind, target_id: targetId }) }),
  rateCourse: (id, stars) => request(`/courses/${id}/rating`, { method: 'POST', body: JSON.stringify({ stars }) }),
  changeMembership: (type) => request('/members/me/membership', { method: 'PUT', body: JSON.stringify({ type }) }),
  withdrawMembershipChange: () => request('/members/me/membership', { method: 'DELETE' }),
  addPause: (startMonth, months) => request('/members/me/pauses', { method: 'POST', body: JSON.stringify({ start_month: startMonth, months }) }),
  deletePause: (id) => request(`/members/me/pauses/${id}`, { method: 'DELETE' }),
  requestLeave: (payload) => request('/leave-requests', { method: 'POST', body: JSON.stringify(payload) }),
  decideLeave: (id, approve) => request(`/leave-requests/${id}/decision`, { method: 'POST', body: JSON.stringify({ approve }) }),
  withdrawLeave: (id) => request(`/leave-requests/${id}`, { method: 'DELETE' }),
  attendanceToday: (studioId) => request(`/attendance/today${studioId ? `?studio_id=${studioId}` : ''}`),
  courseAttendance: (id) => request(`/courses/${id}/attendance`),
  setAttendance: (id, bookingId, attended) => request(`/courses/${id}/attendance`, { method: 'POST', body: JSON.stringify({ booking_id: bookingId, attended }) }),
  scanMember: (id, code) => request(`/courses/${id}/scan`, { method: 'POST', body: JSON.stringify({ code }) }),
  emails: () => request('/emails'),
  adminOverview: () => request('/admin/overview'),
  adminMembers: (params) => request(`/admin/members?${new URLSearchParams(params)}`),
  adminMember: (id) => request(`/admin/members/${id}`),
  adminUpdateMember: (id, payload) => request(`/admin/members/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminTrials: () => request('/admin/trial-requests'),
  financeReport: (month) => request(`/admin/finance?month=${month}`),
  addExpense: (payload) => request('/admin/expenses', { method: 'POST', body: JSON.stringify(payload) }),
  deleteExpense: (id) => request(`/admin/expenses/${id}`, { method: 'DELETE' }),
  updateEmployee: (id, payload) => request(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminUpdateTrial: (id, status) => request(`/admin/trial-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  stats: () => request('/stats'),
  createTrialRequest: (payload) => request('/trial-requests', { method: 'POST', body: JSON.stringify(payload) }),
  createEmployee: (payload) => request('/employees', { method: 'POST', body: JSON.stringify(payload) }),
  deleteEmployee: (id) => request(`/employees/${id}`, { method: 'DELETE' }),
  createAbsence: (id, payload) => request(`/employees/${id}/absence`, { method: 'POST', body: JSON.stringify(payload) }),
  markAvailable: (id) => request(`/employees/${id}/available`, { method: 'POST' }),
  setAvailability: (id, weekStart, slots) => request(`/employees/${id}/availability`, { method: 'PUT', body: JSON.stringify({ week_start: weekStart, slots }) }),
  messageParticipants: (id, text) => request(`/courses/${id}/message`, { method: 'POST', body: JSON.stringify({ text }) }),
  createCourse: (payload) => request('/courses', { method: 'POST', body: JSON.stringify(payload) }),
  generateWeekCourses: (week_start) => request('/courses/generate-week', { method: 'POST', body: JSON.stringify({ week_start }) }),
  generateYearCourses: (year) => request('/courses/generate-year', { method: 'POST', body: JSON.stringify({ year }) }),
  updateCourse: (id, payload) => request(`/courses/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCourse: (id) => request(`/courses/${id}`, { method: 'DELETE' }),
  assignCourse: (id, trainer_id) => request(`/courses/${id}/assign`, { method: 'POST', body: JSON.stringify({ trainer_id }) }),
  cancelCourse: (id) => request(`/courses/${id}/cancel`, { method: 'POST' }),
  getReplacements: (courseId) => request(`/replacements?course_id=${courseId}`),
  createStudio: (payload) => request('/studios', { method: 'POST', body: JSON.stringify(payload) }),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),
}
