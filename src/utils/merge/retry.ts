/** 合并执行器：成功返回结果，失败按 attempts 重试，全部失败抛出最后一次错误 */
export async function withRetry<T>(fn: () => T, attempts = 3): Promise<{ result: T; tries: number }> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return { result: fn(), tries: i };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
