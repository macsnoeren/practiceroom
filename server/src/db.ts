import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client for the whole server process.
 * Connection is lazy; the first query opens the SQLite file.
 */
export const prisma = new PrismaClient();
