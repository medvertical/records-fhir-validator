/** Preserve the first rejection without releasing an owner's still-running children. */
export async function awaitAllDrained<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  try {
    return await Promise.all(tasks);
  } finally {
    await Promise.allSettled(tasks);
  }
}
