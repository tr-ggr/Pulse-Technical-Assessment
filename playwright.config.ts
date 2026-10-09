import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The e2e suite runs against the real local stack (Postgres + Mapbox), so it
// needs the same .env the app uses. Optional — the spec skips without it.
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {}

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
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
    command: "npm run dev",
    url: "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
