// Books live in the plugin's own SQLite database. better-sqlite3 is
// synchronous, so every read-modify-write in `mutate` is atomic with respect
// to concurrent tool calls and thread events.
import { EVENT_LIMIT, builtAt, type BookEvent, type BookState } from "./book";

export interface SqlStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
}

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS books (
     id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     status TEXT NOT NULL,
     data TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS books_thread ON books (thread_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS agents (
     thread_id TEXT PRIMARY KEY,
     book_id TEXT NOT NULL,
     role TEXT NOT NULL,
     builder_index INTEGER
   )`,
];

export type AgentRole = "builder" | "master";
export interface AgentBinding {
  bookId: string;
  role: AgentRole;
  builderIndex: number | null;
}

export class BookStore {
  constructor(
    private readonly db: SqlDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  insert(book: BookState): void {
    this.db
      .prepare(
        `INSERT INTO books (id, thread_id, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        book.id,
        book.threadId,
        book.status,
        JSON.stringify(book),
        book.createdAt,
        book.updatedAt,
      );
  }

  get(id: string): BookState | null {
    const row = this.db
      .prepare(`SELECT data FROM books WHERE id = ?`)
      .get(id) as { data: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.data) as BookState);
  }

  list(options: { threadId?: string; limit?: number } = {}): BookState[] {
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));
    const rows = (
      options.threadId === undefined
        ? this.db
            .prepare(`SELECT data FROM books ORDER BY created_at DESC LIMIT ?`)
            .all(limit)
        : this.db
            .prepare(
              `SELECT data FROM books WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(options.threadId, limit)
    ) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as BookState);
  }

  /** Every book a thread planned. */
  forThread(threadId: string): BookState[] {
    const rows = this.db
      .prepare(`SELECT data FROM books WHERE thread_id = ? ORDER BY created_at`)
      .all(threadId) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as BookState);
  }

  all(): BookState[] {
    const rows = this.db.prepare(`SELECT data FROM books ORDER BY created_at`).all() as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as BookState);
  }

  /** Finished builds, most recently finished first, for the collector's shelf. */
  listComplete(options: { includeDemos: boolean; limit: number; offset: number }): {
    books: BookState[];
    total: number;
    demos: number;
  } {
    const rows = this.db
      .prepare(`SELECT data FROM books WHERE status = 'complete'`)
      .all() as { data: string }[];
    const all = rows.map((row) => JSON.parse(row.data) as BookState).sort((a, b) => builtAt(b) - builtAt(a));
    const demos = all.filter((book) => book.demo === true).length;
    const books = options.includeDemos ? all : all.filter((book) => book.demo !== true);
    return { books: books.slice(options.offset, options.offset + options.limit), total: books.length, demos };
  }

  listActive(): BookState[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM books WHERE status IN ('configuring', 'building', 'assembling') ORDER BY created_at`,
      )
      .all() as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as BookState);
  }

  /**
   * Apply `change` to the stored book and save it. Returns null when the book
   * does not exist. `change` must be synchronous.
   */
  mutate<R>(
    id: string,
    change: (book: BookState, log: (event: Omit<BookEvent, "at">) => void) => R,
  ): { book: BookState; result: R } | null {
    const book = this.get(id);
    if (book === null) return null;
    const at = this.now();
    const result = change(book, (event) => {
      book.events.push({ ...event, at });
      if (book.events.length > EVENT_LIMIT) {
        book.events.splice(0, book.events.length - EVENT_LIMIT);
      }
    });
    book.updatedAt = at;
    this.db
      .prepare(`UPDATE books SET status = ?, data = ?, updated_at = ? WHERE id = ?`)
      .run(book.status, JSON.stringify(book), at, id);
    return { book, result };
  }

  bindAgent(threadId: string, binding: AgentBinding): void {
    this.db
      .prepare(
        `INSERT INTO agents (thread_id, book_id, role, builder_index) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET book_id = excluded.book_id, role = excluded.role, builder_index = excluded.builder_index`,
      )
      .run(threadId, binding.bookId, binding.role, binding.builderIndex);
  }

  agentFor(threadId: string): AgentBinding | null {
    const row = this.db
      .prepare(`SELECT book_id, role, builder_index FROM agents WHERE thread_id = ?`)
      .get(threadId) as
      | { book_id: string; role: string; builder_index: number | null }
      | undefined;
    if (row === undefined) return null;
    if (row.role !== "builder" && row.role !== "master") return null;
    return {
      bookId: row.book_id,
      role: row.role,
      builderIndex: row.builder_index,
    };
  }
}
