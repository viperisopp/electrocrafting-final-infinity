// Memories: loads memories.json and tracks which ones are unlocked. (M6)

export function createMemories(list = []) {
  return { list, unlocked: new Set() };
}

export function unlock(memories, id) {
  if (memories.unlocked.has(id)) return false;
  memories.unlocked.add(id);
  return true;
}
