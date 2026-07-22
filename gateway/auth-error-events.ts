import type { Db, Document } from "mongodb";

const retentionMs = 14 * 24 * 60 * 60 * 1_000;

export interface AuthErrorEvent {
  requestId: string;
  path: string;
  source: "better-auth" | "api-error" | "auth-handler" | "oauth-error-response";
  message: string;
  errorCode?: string | number;
  errorName?: string;
  errorCodeName?: string;
  status?: string | number;
  details?: unknown[];
}

interface AuthErrorDocument extends Document, AuthErrorEvent {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
}

export function createMongoAuthErrorRecorder(
  database: Db,
  schedule: (promise: Promise<unknown>) => void,
  onFailure: (error: unknown) => void,
) {
  const events = database.collection<AuthErrorDocument>("auth_error_events");
  return (event: AuthErrorEvent): Promise<void> => {
    const createdAt = new Date();
    const write = events.insertOne({
      _id: crypto.randomUUID(),
      ...event,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + retentionMs),
    }).then(() => undefined).catch((error) => {
      onFailure(error);
    });
    // waitUntil protects the write if a Worker request is terminated, while
    // returning the same promise lets the auth handler confirm persistence
    // before it returns an error response or redirect.
    schedule(write);
    return write;
  };
}
