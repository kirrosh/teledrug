import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import process from "node:process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import ngrok from "@ngrok/ngrok";
import type { Config as NgrokConfig, Listener as NgrokListener } from "@ngrok/ngrok";

type ManagedProcess = ChildProcess;

const managedProcesses: ManagedProcess[] = [];
const args = new Set(process.argv.slice(2));
let shuttingDown = false;
let tunnel: NgrokListener | null = null;

const MINIAPP_PORT = Number.parseInt(process.env.MINIAPP_PORT ?? "3001", 10);
const MINIAPP_HOST = process.env.MINIAPP_HOST ?? "127.0.0.1";

if (Number.isNaN(MINIAPP_PORT) || MINIAPP_PORT <= 0) {
  console.error(`❌ Invalid MINIAPP_PORT value: ${process.env.MINIAPP_PORT}`);
  process.exit(1);
}

const log = (message: string) => {
  console.log(`[miniapp-stack] ${message}`);
};

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const shouldStartBot = (() => {
  if (args.has("--skip-bot") || args.has("--no-bot")) return false;
  if (args.has("--bot") || args.has("--with-bot")) return true;

  const envOverride = parseBoolean(process.env.STACK_START_BOT);
  if (envOverride !== undefined) return envOverride;

  const envSkip = parseBoolean(process.env.STACK_SKIP_BOT);
  if (envSkip !== undefined) return !envSkip;

  return true;
})();

const shouldForceMiniapp = args.has("--force") || args.has("--force-port");
const shouldAutoConfirmBot = (() => {
  if (args.has("--yes") || args.has("--auto") || args.has("--auto-bot")) {
    return true;
  }

  const envConfirm = parseBoolean(process.env.STACK_CONFIRM_BOT_START);
  if (envConfirm !== undefined) {
    return envConfirm;
  }

  return false;
})();

const spawnManaged = (
  label: string,
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2] = {},
) => {
  log(`Starting ${label}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  managedProcesses.push(child);

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
      log(`${label} exited (${reason}). Shutting down stack...`);
      void shutdown(code ?? 0);
    }
  });

  child.on("error", (error) => {
    log(`${label} process error: ${(error as Error).message}`);
    if (!shuttingDown) {
      void shutdown(1);
    }
  });

  return child;
};

const waitForPort = async (
  port: number,
  host: string,
  { timeoutMs = 60_000, intervalMs = 500 } = {},
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ port, host }, () => {
          socket.end();
          resolve();
        });

        socket.on("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });

      return;
    } catch {
      await delay(intervalMs);
    }
  }

  throw new Error(`Timed out waiting for http://${host}:${port}`);
};

const ensurePortAvailable = async (port: number, host: string) => {
  const available = await new Promise<boolean>((resolve) => {
    const tester = createServer();
    tester.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
      } else {
        log(`Port check error on ${host}:${port}: ${error.message}`);
        resolve(false);
      }
    });

    tester.listen({ port, host }, () => {
      tester.close(() => resolve(true));
    });
  });

  if (!available) {
    if (shouldForceMiniapp) {
      log(
        `WARNING: port ${port} on ${host} is already in use. Continuing because --force is set.`,
      );
      return;
    }

    throw new Error(
      `Port ${port} on ${host} is already in use. Stop the process using it or pass --force to reuse.`,
    );
  }
};

const shutdown = async (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  log("Stopping stack...");

  if (tunnel) {
    try {
      await tunnel.close();
      await ngrok.kill();
      log("ngrok tunnel closed");
    } catch (error) {
      log(`Error closing ngrok tunnel: ${(error as Error).message}`);
    }
  }

  for (const child of managedProcesses) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }

  try {
    await Promise.race([
      Promise.all(managedProcesses.map((child) => once(child, "exit").catch(() => null))),
      delay(2_000),
    ]);
  } catch {
    // ignore
  }

  log("Stack stopped. Bye! 👋");
  process.exit(exitCode);
};

process.on("SIGINT", () => {
  log("Received SIGINT");
  void shutdown(0);
});

process.on("SIGTERM", () => {
  log("Received SIGTERM");
  void shutdown(0);
});

const main = async () => {
  log(`Launching miniapp on port ${MINIAPP_PORT}`);

  await ensurePortAvailable(MINIAPP_PORT, MINIAPP_HOST);

  spawnManaged("miniapp", "bun", [
    "run",
    "--filter",
    "miniapp",
    "dev",
    "--",
    "--port",
    String(MINIAPP_PORT),
  ]);

  try {
    await waitForPort(MINIAPP_PORT, MINIAPP_HOST);
    log("Miniapp is ready");
  } catch (error) {
    log((error as Error).message);
    throw error;
  }

  const config: NgrokConfig = {
    addr: `${MINIAPP_HOST}:${MINIAPP_PORT}`,
    authtoken_from_env: true,
  };

  if (process.env.NGROK_AUTHTOKEN) {
    config.authtoken = process.env.NGROK_AUTHTOKEN;
    config.authtoken_from_env = false;
  }

  log("Opening ngrok tunnel...");
  tunnel = await ngrok.forward(config);

  const publicUrl = tunnel.url();
  if (!publicUrl) {
    throw new Error("ngrok did not return a public URL");
  }

  log(`Miniapp accessible via ${publicUrl}`);

  if (shouldStartBot) {
    let startBotConfirmed = shouldAutoConfirmBot;

    if (!startBotConfirmed && process.stdin.isTTY) {
      const rl = createInterface({ input, output });
      const answer = (await rl.question(
        "Start Telegram bot now? This may conflict if another instance is polling. (y/N) ",
      ))
        .trim()
        .toLowerCase();
      rl.close();
      startBotConfirmed = ["y", "yes"].includes(answer);
    }

    if (startBotConfirmed) {
      const botEnv = {
        ...process.env,
        WEBAPP_URL: publicUrl,
        BOT_HEALTH_SERVER_ENABLED:
          process.env.BOT_HEALTH_SERVER_ENABLED ?? "false",
      };

      log("Starting Telegram bot with updated WEBAPP_URL");
      spawnManaged("bot", "bun", ["run", "apps/bot/src/index.ts"], {
        env: botEnv,
      });
    } else {
      log("Skipping Telegram bot startup (answer was no or non-interactive).");
      log("You can launch it later with: bun run --filter @teledrug/bot dev");
    }
  } else {
    log("Skipping Telegram bot startup (use --with-bot or STACK_START_BOT=true to enable)");
    log(`Use this URL for WEBAPP_URL: ${publicUrl}`);
  }

  log("Stack is up. Press Ctrl+C to stop.");

  await Promise.race(managedProcesses.map((child) => once(child, "exit")));
  await shutdown(0);
};

main().catch(async (error) => {
  log(`❌ ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
});
