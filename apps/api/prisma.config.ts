import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/mtpp' },
});
