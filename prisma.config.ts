import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma 7 reads migration/introspection connection details from here (the
// schema no longer holds a `url`). The Prisma CLI does not auto-load .env, so
// load it manually (Node 20.12+ ships process.loadEnvFile).
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // .env is optional (e.g. on Vercel where vars are injected directly).
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    // CLI only (db push / migrate): prefer the direct, non-pooled URL — schema
    // changes break over PgBouncer transaction pooling. The app itself keeps
    // using the pooled DATABASE_URL via the pg adapter (lib/prisma.ts).
    url: process.env.DATABASE_URL_UNPOOLED || env("DATABASE_URL"),
  },
});
