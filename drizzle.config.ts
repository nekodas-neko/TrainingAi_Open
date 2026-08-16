import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/data/postgres/schema.ts',
  out: './lib/data/postgres/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
