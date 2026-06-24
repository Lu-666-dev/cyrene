import { spawn } from "node:child_process";
import net from "node:net";

const workspaceRoot = new URL("../../..", import.meta.url);
const modelLabRoot = new URL("../../model-lab/", import.meta.url);
const port = await findFreePort(5173);
const petUrl = `http://127.0.0.1:${port}/pet.html`;

let electron;

const modelLab = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: modelLabRoot,
  shell: true,
  stdio: ["ignore", "pipe", "pipe"]
});

modelLab.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!electron && text.includes("Local:")) {
    electron = spawn("npx", ["electron", "."], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        CYRENE_PET_URL: petUrl
      },
      shell: true,
      stdio: "inherit"
    });

    electron.on("exit", () => {
      modelLab.kill();
      process.exit(0);
    });
  }
});

modelLab.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

const shutdown = () => {
  modelLab.kill();
  electron?.kill();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
modelLab.on("exit", (code) => {
  if (!electron) {
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
