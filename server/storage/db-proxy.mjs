/**
 * Dialect-aware SQL executor used while migrating Express handlers to async store access.
 * SQLite methods are synchronous (node:sqlite).
 * Postgres methods return Promises — callers must await get/all/run/exec.
 */
export function createDbProxy(context) {
  return {
    get dialect() {
      return context.executor?.dialect || "sqlite";
    },
    prepare(sql) {
      const executor = context.executor;
      if (!executor) throw new Error("Database executor is not configured.");
      if (executor.dialect === "sqlite") {
        return executor.native.prepare(sql);
      }
      const text = toPostgresPlaceholders(sql);
      return {
        get: async (...params) => {
          const result = await executor.query(text, params);
          return result.rows[0];
        },
        all: async (...params) => {
          const result = await executor.query(text, params);
          return result.rows;
        },
        run: async (...params) => {
          const result = await executor.query(text, params);
          return { changes: result.rowCount ?? 0 };
        },
      };
    },
    exec(sql) {
      const executor = context.executor;
      if (!executor) throw new Error("Database executor is not configured.");
      if (executor.dialect === "sqlite") {
        return executor.native.exec(sql);
      }
      return executor.query(sql);
    },
  };
}

export function toPostgresPlaceholders(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

export async function withExecutorTransaction(context, store, operation) {
  if (store.dialect === "sqlite") {
    const db = store.native;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // preserve original
      }
      throw error;
    }
  }

  const previous = context.executor;
  return store.transaction(async (tx) => {
    context.executor = tx;
    try {
      return await operation();
    } finally {
      context.executor = previous;
    }
  });
}

/**
 * Hosted durability claim.
 * - SQLite free Render: always non-durable
 * - Postgres/Neon: durable only after explicit PROOFLET_DURABILITY_PROVEN=true
 *   (set only after a unique record survives restart/redeploy)
 */
export function storageStatusForStore(store, env = process.env) {
  if (store.dialect === "postgres") {
    const proven = env["PROOFLET_DURABILITY_PROVEN"] === "true";
    return {
      configured: true,
      durable: proven,
      mode: proven ? "neon-postgres" : "neon-postgres-unproven",
      dialect: "postgres",
    };
  }
  return {
    configured: true,
    durable: false,
    mode: "local",
    dialect: "sqlite",
  };
}
