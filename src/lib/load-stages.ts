// Progress through the steps that follow the downloads: compiling the scene's
// shaders and rendering the first frame. The loading overlay reads this
// alongside the download progress.

export type Steps = { done: number; total: number };

export type LoadStages = {
  shaders: Steps;
  firstFrame: boolean;
};

const listeners = new Set<() => void>();
let snapshot: LoadStages = {
  shaders: { done: 0, total: 0 },
  firstFrame: false,
};

function update(next: Partial<LoadStages>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export function shadersProgress(done: number, total: number) {
  update({ shaders: { done, total } });
}

export function firstFrameRendered() {
  if (!snapshot.firstFrame) update({ firstFrame: true });
}

export function subscribeToStages(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLoadStages() {
  return snapshot;
}
