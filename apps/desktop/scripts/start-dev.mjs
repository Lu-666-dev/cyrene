import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const workspaceRoot = new URL("../../../", import.meta.url);
const modelLabRoot = new URL("../../model-lab/", import.meta.url);
const desktopRoot = new URL("../", import.meta.url);
const viteCli = fileURLToPath(new URL("node_modules/vite/bin/vite.js", workspaceRoot));
const electronCli = fileURLToPath(new URL("node_modules/electron/cli.js", workspaceRoot));
const port = await findFreePort(5173);
const petDebugQuery = process.env.CYRENE_PET_DEBUG === "1" ? "?debugPet=1" : "";
const petUrl = `http://127.0.0.1:${port}/pet.html${petDebugQuery}`;

let electron;
let shuttingDown = false;

const modelLab = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: fileURLToPath(modelLabRoot),
  stdio: "inherit"
});

modelLab.on("error", (error) => {
  failStartup("Vite", error);
});

try {
  await waitForPort(port, modelLab);
  startElectron();
} catch (error) {
  failStartup("Vite", error);
}

function startElectron() {
  const electronEnv = {
    ...process.env,
    CYRENE_PET_URL: petUrl
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  console.log(`[Cyrene] Starting Electron with ${petUrl}`);
  electron = spawn(process.execPath, [electronCli, "."], {
    cwd: fileURLToPath(desktopRoot),
    env: electronEnv,
    stdio: "inherit"
  });

  electron.on("error", (error) => {
    failStartup("Electron", error);
  });

  electron.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    modelLab.kill();
    if (code && code !== 0) {
      console.error(`[Cyrene] Electron exited with code ${code}${signal ? ` (${signal})` : ""}.`);
    }
    process.exit(code ?? 0);
  });
}

function failStartup(component, error) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.error(`[Cyrene] Failed to start ${component}:`, error);
  modelLab.kill();
  electron?.kill();
  process.exit(1);
}

function waitForPort(targetPort, viteProcess, timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (viteProcess.exitCode !== null) {
        reject(new Error(`Vite exited with code ${viteProcess.exitCode} before becoming ready.`));
        return;
      }

      const socket = net.createConnection({ host: "127.0.0.1", port: targetPort });
      socket.setTimeout(500);

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      const retry = () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for Vite on port ${targetPort}.`));
          return;
        }
        setTimeout(attempt, 100);
      };

      socket.once("error", retry);
      socket.once("timeout", retry);
    };

    attempt();
  });
}

const shutdown = () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  modelLab.kill();
  electron?.kill();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
modelLab.on("exit", (code) => {
  if (!electron && !shuttingDown) {
    process.exit(code ?? 1);
  }
});

function findFreePort(startPort) {
  return new Promise((resolve) => {
    const tryPort = (candidate) => {
      const server = net.createServer();
      server.once("error", () => tryPort(candidate + 1));
      server.once("listening", () => {
        server.close(() => resolve(candidate));
      });
      server.listen(candidate, "127.0.0.1");
    };

    tryPort(startPort);
  });
}
