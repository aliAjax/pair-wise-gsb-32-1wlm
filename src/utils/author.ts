import { STORAGE_KEYS } from '../constants/storageVersion';

const DEFAULT_AUTHOR = '我';

/** 当前正在编辑的作者（结伴改行程时区分是谁改的） */
export function currentAuthor(): string {
  return localStorage.getItem(STORAGE_KEYS.mergeAuthor) || DEFAULT_AUTHOR;
}

export function setCurrentAuthor(author: string) {
  localStorage.setItem(STORAGE_KEYS.mergeAuthor, author);
}

/** 给一次写入打上作者和修改时间 */
export function stamp<T>(record: T, author?: string): T {
  return { ...(record as object), author: author || currentAuthor(), updated_at: new Date().toISOString() } as T;
}
