import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The e2e suite runs against the real local stack (Postgres + Mapbox), so it
// needs the same .env the app uses. Optional — the spec skips without it.
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {}

// Dedicated port so the suite never attaches to some other app on :3000.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
// E2E_SERVER=start runs against a production build (`npm run build` first),
// which serves the production CSP — no 'unsafe-eval' as in dev.
const SERVER = process.env.E2E_SERVER === "start" ? "start" : "dev";

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            // Auto-grant + synthesize camera/mic so video works headless.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            // Software WebGL for Mapbox GL in headless runs.
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run ${SERVER} -- --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
