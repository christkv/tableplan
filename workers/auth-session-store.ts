import { DurableObject } from "cloudflare:workers";

interface StoredValue {
  value: string;
  expiresAt: number | null;
}

const entryKey = "value";

/** Strongly consistent, one-key-per-object storage for Better Auth sessions. */
export class AuthSessionStoreDO extends DurableObject<CloudflareEnvironment> {
  private async current(storage: Pick<DurableObjectStorage, "get" | "delete"> = this.ctx.storage): Promise<StoredValue | null> {
    const entry = await storage.get<StoredValue>(entryKey);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      await storage.delete(entryKey);
      return null;
    }
    return entry;
  }

  async getValue(): Promise<string | null> {
    return (await this.current())?.value ?? null;
  }

  async setValue(value: string, ttl?: number): Promise<void> {
    const expiresAt = ttl && ttl > 0 ? Date.now() + ttl * 1_000 : null;
    await this.ctx.storage.put(entryKey, { value, expiresAt } satisfies StoredValue);
    if (expiresAt !== null) await this.ctx.storage.setAlarm(expiresAt);
    else await this.ctx.storage.deleteAlarm();
  }

  async deleteValue(): Promise<void> {
    await this.ctx.storage.delete(entryKey);
    await this.ctx.storage.deleteAlarm();
  }

  async getAndDeleteValue(): Promise<string | null> {
    return this.ctx.storage.transaction(async (transaction) => {
      const entry = await this.current(transaction);
      await transaction.delete(entryKey);
      await transaction.deleteAlarm();
      return entry?.value ?? null;
    });
  }

  async incrementValue(ttl: number): Promise<number> {
    return this.ctx.storage.transaction(async (transaction) => {
      const entry = await this.current(transaction);
      const value = (entry ? Number.parseInt(entry.value, 10) || 0 : 0) + 1;
      const expiresAt = entry?.expiresAt ?? (ttl > 0 ? Date.now() + ttl * 1_000 : null);
      await transaction.put(entryKey, { value: String(value), expiresAt } satisfies StoredValue);
      if (!entry && expiresAt !== null) await transaction.setAlarm(expiresAt);
      return value;
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.delete(entryKey);
  }
}
