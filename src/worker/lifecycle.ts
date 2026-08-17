type AsyncTask = () => void | Promise<void>;

export function createShutdownHandler(input: {
  stop: AsyncTask;
  disconnect: AsyncTask;
  exit: (code: number) => void;
  onError?: (error: unknown) => void;
}) {
  let shuttingDown = false;

  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    let exitCode = 0;
    for (const task of [input.stop, input.disconnect]) {
      try {
        await task();
      } catch (error) {
        exitCode = 1;
        input.onError?.(error);
      }
    }
    input.exit(exitCode);
  };
}
