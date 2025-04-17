import { SQL } from "bun";

export const sql = new SQL({ url: process.env.DATABASE_URL });
