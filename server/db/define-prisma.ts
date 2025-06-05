import type { ModelDefinition } from "./types-gen";
import type { SiteConfig } from "../../client";

/**
 * Define a database connection using Prisma ORM
 * @param models The model definitions (not used with Prisma but kept for API consistency)
 * @param connectionUrl Connection URL for the database
 * @param config Site configuration
 * @returns A Prisma client instance
 */
export const definePrismaDB = async <T extends { [K in string]: ModelDefinition<K> }>(
  models: T,
  connectionUrl: string,
  config: SiteConfig
) => {
  try {
    // Dynamically import PrismaClient to avoid loading it unless needed
    const { PrismaClient } = await import('@prisma/client');
    return new PrismaClient();
  } catch (error) {
    console.error('Failed to initialize Prisma client:', error);
    throw new Error('Prisma client initialization failed. Make sure you have run prisma generate.');
  }
};