export class TimeoutExceededError extends Error {}

/**
 * Races `work` against a timer. Kept standalone (rather than inlined in
 * LayoutPdfReader) so its behavior can be verified with fully controlled
 * promises instead of racing against pdfjs's real, cache-dependent parse
 * time — that made the equivalent inline test flaky under a warm module
 * cache.
 */
export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutExceededError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
