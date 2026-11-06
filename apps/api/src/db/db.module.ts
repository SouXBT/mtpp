import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { argsToDb, fromDb, fromRaw } from './convert';

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  transactionOptions: { maxWait: 10000, timeout: 60000 },
});

export const db = client.$extends({
  query: {
    async $allOperations({ model, args, query }: any) {
      if (!model) return fromRaw(await query(args));
      return fromDb(model, await query(argsToDb(model, args)));
    },
  },
});

export type Db = typeof db;
export const DB = 'DB';

@Global()
@Module({ providers: [{ provide: DB, useValue: db }], exports: [DB] })
export class DbModule {}
