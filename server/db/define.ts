import type { SiteConfig } from "../../client";
import { defineOracleDB, definePostgresDB } from "./define-rlib";
import type { ModelDefinition } from "./types-gen";

/**
 * Define a database connection based on the provided URL or config
 * This function detects the database type and uses the appropriate driver
 * @param models The model definitions or a PrismaClient instance when orm is 'prisma'
 * @param connectionInfo Connection URL PostgreSQL or Oracle connection string (format: "User Id=x;Password=y;Data Source=z")
 * @returns A model operations object for interacting with the database or PrismaClient instance when orm is 'prisma'
 */
export const defineDB = async <
  T extends { [K in string]: ModelDefinition<K> } | any
>(
  models: T,
  connectionInfo: string,
  config: SiteConfig
) => {
  // Check if Prisma ORM is configured
  if (config.db?.orm === "prisma") {
    return models;
  }

  // Check if the connectionInfo is an Oracle connection string
  if (connectionInfo.includes("User Id=") || connectionInfo.includes("user=")) {
    // Parse Oracle connection string
    const parseOracleConnectionString = (connStr: string) => {
      const config: {
        user: string;
        password: string;
        connectString: string;
        [key: string]: any;
      } = {
        user: "",
        password: "",
        connectString: "",
      };

      // Split by semicolons and process each key-value pair
      const parts = connStr.split(";");
      for (const part of parts) {
        const [key, value] = part.split("=").map((s) => s.trim());

        if (!key || !value) continue;

        // Map to proper configuration keys
        if (key.toLowerCase() === "user id" || key.toLowerCase() === "user") {
          config.user = value;
        } else if (key.toLowerCase() === "password") {
          config.password = value;
        } else if (key.toLowerCase() === "data source") {
          config.connectString = value;
        } else {
          // Add any other parameters as is
          config[key] = value;
        }
      }

      return config;
    };

    const oracleConfig = parseOracleConnectionString(connectionInfo);
    return defineOracleDB(
      models as T & { [K in string]: ModelDefinition<K> },
      oracleConfig
    );
  } else {
    // It's a PostgreSQL connection URL
    return definePostgresDB(
      models as T & { [K in string]: ModelDefinition<K> },
      connectionInfo,
      config
    );
  }
};
