/**
 * One audit-run-owned transport pool for candidate-aware model work.
 *
 * It bounds concurrent verifier and countercheck dispatches without imposing a
 * limit on candidates, source evidence, or recovery work. Callers retain the
 * original item order and terminal result for every scheduled unit.
 */
export type CandidateAwareDispatchPool = Readonly<{
  run: <Result>(action: () => Promise<Result>) => Promise<Result>;
  cancel: (error: Error) => void;
}>;

type QueuedCandidateAwareDispatch = Readonly<{
  execute: () => Promise<void>;
  reject: (error: Error) => void;
}>;

export function createCandidateAwareDispatchPool(maximum: number): CandidateAwareDispatchPool {
  let activeCount = 0;
  const pending: QueuedCandidateAwareDispatch[] = [];
  let cancellation: Error | undefined;

  function dispatch(): void {
    while (activeCount < maximum) {
      const next = pending.shift();
      if (next === undefined) return;
      activeCount += 1;
      void next.execute().finally(() => {
        activeCount -= 1;
        dispatch();
      });
    }
  }

  return Object.freeze({
    run: <Result>(action: () => Promise<Result>): Promise<Result> =>
      new Promise<Result>((resolve, reject) => {
        if (cancellation !== undefined) {
          reject(cancellation);
          return;
        }
        pending.push({
          execute: async () => {
            try {
              resolve(await action());
            } catch (error) {
              reject(error);
            }
          },
          reject,
        });
        dispatch();
      }),
    cancel: (error) => {
      if (cancellation !== undefined) return;
      cancellation = error;
      for (const queued of pending.splice(0)) queued.reject(error);
    },
  });
}
