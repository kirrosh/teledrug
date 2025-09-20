import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://teledrug:teledrug_secret_2024@localhost:5432/teledrug_db';

export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema });

export type Database = typeof db;
