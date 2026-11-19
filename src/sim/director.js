// Director: decides when and where the next space event spawns. (M5)

export function createDirector() {
  return { active: [] };
}

export function updateDirector(director, dt, state) {
  for (const e of director.active) e.update(dt, state);
}
