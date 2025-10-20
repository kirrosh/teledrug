import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://teledrug:teledrug_secret_2024@localhost:5432/teledrug_db",
  },
} satisfies Config;
