interface AuthSessionStoreStub {
  getValue(): Promise<string | null>;
  setValue(value: string, ttl?: number): Promise<void>;
  deleteValue(): Promise<void>;
  getAndDeleteValue(): Promise<string | null>;
  incrementValue(ttl: number): Promise<number>;
}

interface AuthSessionStoreNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): AuthSessionStoreStub;
}

async function objectName(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createAuthSessionStorage(namespace: AuthSessionStoreNamespace) {
  const stub = async (key: string) => namespace.get(namespace.idFromName(await objectName(key)));
  return {
    async get(key: string) { return (await stub(key)).getValue(); },
    async set(key: string, value: string, ttl?: number) { await (await stub(key)).setValue(value, ttl); },
    async delete(key: string) { await (await stub(key)).deleteValue(); },
    async getAndDelete(key: string) { return (await stub(key)).getAndDeleteValue(); },
    async increment(key: string, ttl: number) { return (await stub(key)).incrementValue(ttl); },
  };
}
