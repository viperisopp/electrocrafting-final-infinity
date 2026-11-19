// Session flow: intro / explore / found-Earth, idle reset. (M7)
// For now the session starts straight in 'explore'.

export function createSession() {
  return { phase: 'explore', idle: 0 };
}

export function updateSession(session, dt, controls) {
  const active = controls.button || controls.pitch || controls.yaw;
  session.idle = active ? 0 : session.idle + dt;
}
