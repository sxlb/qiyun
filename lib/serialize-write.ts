/**
 * 进程内写串行化队列。
 * SQLite 同一时刻只允许一个写事务；当同一进程内多个请求并发执行写操作时，
 * 未加等待的写会直接返回 SQLITE_BUSY。个人站点为单实例部署（内存限流器同理），
 * 因此用一个模块级 Promise 链把所有写任务串行执行，从根源消除同进程写竞争。
 */
let tail: Promise<unknown> = Promise.resolve();

/** 将 task 排入写队列串行执行，返回该任务自身的 Promise（失败不影响后续任务） */
export function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(() => task());
  tail = run.catch(() => undefined);
  return run;
}
