const TEST_USER = {
  name: "Local Test User",
  username: "tableplanlocal",
  email: "local-test@tableplan.test",
  password: "Tableplan-local-2026!",
} as const;

export {};

function localBaseUrl(): URL {
  const value = process.env.LOCAL_APP_URL ?? "http://127.0.0.1:5173";
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("LOCAL_APP_URL must be an HTTP loopback URL; refusing to seed a remote server");
  }
  return url;
}

async function authRequest(baseUrl: URL, path: string, body: object): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl.origin },
    body: JSON.stringify(body),
  });
}

function safeResponseMessage(value: string): string {
  try {
    const parsed = JSON.parse(value) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 240);
  } catch { /* The response is not JSON. */ }
  return value.trim().slice(0, 240) || "Unknown authentication error";
}

async function main() {
  const baseUrl = localBaseUrl();
  const signIn = await authRequest(baseUrl, "/api/auth/sign-in/username", {
    username: TEST_USER.username,
    password: TEST_USER.password,
  });
  if (!signIn.ok) {
    const signUp = await authRequest(baseUrl, "/api/auth/sign-up/email", TEST_USER);
    if (!signUp.ok) throw new Error(`Could not create local test user: ${safeResponseMessage(await signUp.text())}`);
  }
  process.stdout.write(`Local test user is ready at ${baseUrl.origin}\nUsername: ${TEST_USER.username}\nEmail: ${TEST_USER.email}\nPassword: ${TEST_USER.password}\n`);
}

await main();
