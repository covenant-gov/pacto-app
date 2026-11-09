/** Cache a resolved import; drop it if the load rejects so a retry can run. */
export function createLazyComponent<C>(
  loader: () => Promise<{ default: C }>,
): () => Promise<C> {
  let cached: Promise<{ default: C }> | null = null;
  return () => {
    if (!cached) {
      const pending = loader().then(
        (mod) => mod,
        (err: unknown) => {
          if (cached === pending) cached = null;
          throw err;
        },
      );
      cached = pending;
    }
    return cached.then((m) => m.default);
  };
}
