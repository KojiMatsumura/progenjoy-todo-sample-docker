export type TodoItem = {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
};

export type ApiPayload = {
  content?: Record<string, unknown> | null;
};

export function genTodoId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return String(Date.now()) + "-" + String(Math.random()).slice(2, 10);
}

export function normalizeItemsFromRoot(root: Record<string, unknown>): {
  items: TodoItem[];
  migrationNeeded: boolean;
} {
  const ta = root.todoApp;
  const raw: unknown[] = [];
  if (ta && typeof ta === "object" && ta !== null && Array.isArray((ta as { items?: unknown }).items)) {
    raw.push(...((ta as { items: unknown[] }).items));
  }
  let migrationNeeded = false;
  const out: TodoItem[] = [];
  for (const rawItem of raw) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const it = rawItem as Record<string, unknown>;
    let id: string;
    if (typeof it.id === "string" && it.id.length > 0) {
      id = it.id;
    } else {
      migrationNeeded = true;
      id = genTodoId();
    }
    const title = typeof it.title === "string" ? it.title : "";
    let createdAt: string;
    if (typeof it.createdAt === "string" && it.createdAt.length > 0) {
      createdAt = it.createdAt;
    } else {
      migrationNeeded = true;
      createdAt = new Date().toISOString();
    }
    out.push({
      id,
      title,
      done: !!it.done,
      createdAt,
    });
  }
  return { items: out, migrationNeeded };
}

export function buildContentForSave(
  lastContent: Record<string, unknown>,
  items: TodoItem[]
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const k of Object.keys(lastContent)) {
    next[k] = lastContent[k];
  }
  next.todoApp = {
    items: items.map((it) => ({
      id: it.id,
      title: it.title,
      done: !!it.done,
      createdAt: it.createdAt,
    })),
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export function formatDateShort(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatDateLong(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
