import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const parsedBaseURL = new URL(baseURL);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsedBaseURL.hostname)) {
  throw new Error("PLAYWRIGHT_BASE_URL must use localhost when the test runner manages Next.js.");
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const serverEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "local-e2e-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "local-e2e-service-role-key",
  APP_URL: baseURL,
  // Full-stack browser tests must never consume a developer or production
  // provider key implicitly from .env.local. Opt in with a dedicated test key.
  GROQ_API_KEY: process.env.E2E_GROQ_API_KEY ?? "",
};

let server;
let serverOutput = "";
const alreadyRunning = await isReady();
if (!alreadyRunning) {
  server = spawn(process.execPath, [nextBin, "start", "--hostname", parsedBaseURL.hostname, "--port", parsedBaseURL.port || "3000"], {
    cwd: root,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const remember = (chunk) => { serverOutput = `${serverOutput}${String(chunk)}`.slice(-8_000); };
  server.stdout.on("data", remember);
  server.stderr.on("data", remember);
  await waitUntilReady();
}

let exitCode = 1;
try {
  const forwardedArgs = process.argv.slice(2);
  if (forwardedArgs[0] === "--") forwardedArgs.shift();
  const runner = spawn(process.execPath, [playwrightCli, "test", ...forwardedArgs], {
    cwd: root,
    env: serverEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  exitCode = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  if (server && !server.killed) server.kill();
}

process.exitCode = exitCode;

async function isReady() {
  try {
    const response = await fetch(new URL("/login", baseURL), { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await isReady()) return;
    if (server?.exitCode !== null) throw new Error(`Next.js exited before becoming ready.\n${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (server && !server.killed) server.kill();
  throw new Error(`Next.js did not become ready within 120 seconds.\n${serverOutput}`);
}
