import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetConfigCache } from "@agora/common";
import { z } from "zod";
const cliConfigSchema = z.object({
  rpc_url: z.string().url().optional(),
  api_url: z.string().url().optional(),
  pinata_jwt: z.string().optional(),
  private_key: z.string().optional(),
  factory_address: z.string().optional(),
  usdc_address: z.string().optional(),
  chain_id: z.number().int().optional(),
  supabase_url: z.string().url().optional(),
  supabase_anon_key: z.string().optional(),
  supabase_service_key: z.string().optional(),
});

export type CliConfig = z.infer<typeof cliConfigSchema>;

const configDir = path.join(os.homedir(), ".agora");
const configPath = path.join(configDir, "config.json");

export function getConfigPath() {
  return configPath;
}

export function readConfigFile(): CliConfig {
  if (!fs.existsSync(configPath)) return {};
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return cliConfigSchema.parse(parsed);
}

export function writeConfigFile(config: CliConfig) {
  fs.mkdirSync(configDir, { recursive: true });
  const validated = cliConfigSchema.parse(config);
  fs.writeFileSync(configPath, JSON.stringify(validated, null, 2));
}

export function loadCliConfig(): CliConfig {
  const fileConfig = readConfigFile();
  const envConfig: CliConfig = {
    rpc_url: process.env.AGORA_RPC_URL,
    api_url: process.env.AGORA_API_URL,
    pinata_jwt: process.env.AGORA_PINATA_JWT,
    private_key: process.env.AGORA_PRIVATE_KEY,
    factory_address: process.env.AGORA_FACTORY_ADDRESS,
    usdc_address: process.env.AGORA_USDC_ADDRESS,
    chain_id: process.env.AGORA_CHAIN_ID
      ? Number(process.env.AGORA_CHAIN_ID)
      : undefined,
    supabase_url: process.env.AGORA_SUPABASE_URL,
    supabase_anon_key: process.env.AGORA_SUPABASE_ANON_KEY,
    supabase_service_key: process.env.AGORA_SUPABASE_SERVICE_KEY,
  };

  return {
    ...fileConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([, v]) => v !== undefined && v !== ""),
    ),
  };
}

export function applyConfigToEnv(config: CliConfig) {
  const setIfMissing = (key: string, value: string | number | undefined) => {
    if (value === undefined) return;
    if (!process.env[key]) {
      process.env[key] = String(value);
    }
  };

  setIfMissing("AGORA_RPC_URL", config.rpc_url);
  setIfMissing("AGORA_API_URL", config.api_url);
  setIfMissing("AGORA_PINATA_JWT", config.pinata_jwt);
  setIfMissing("AGORA_PRIVATE_KEY", config.private_key);
  setIfMissing("AGORA_FACTORY_ADDRESS", config.factory_address);
  setIfMissing("AGORA_USDC_ADDRESS", config.usdc_address);
  setIfMissing("AGORA_CHAIN_ID", config.chain_id);
  setIfMissing("AGORA_SUPABASE_URL", config.supabase_url);
  setIfMissing("AGORA_SUPABASE_ANON_KEY", config.supabase_anon_key);
  setIfMissing("AGORA_SUPABASE_SERVICE_KEY", config.supabase_service_key);

  // Ensure loadConfig() re-parses after env mutation in this process.
  resetConfigCache();
}

export function requireConfigValues(
  config: CliConfig,
  keys: (keyof CliConfig)[],
) {
  const missing = keys.filter((key) => {
    const value = config[key];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    throw new Error(`Missing required config values: ${missing.join(", ")}.`);
  }
}

export function setConfigValue(key: keyof CliConfig, value: string) {
  const config = readConfigFile();
  const updated: CliConfig = {
    ...config,
    [key]: key === "chain_id" ? Number(value) : value,
  };
  writeConfigFile(updated);
}

export function getConfigValue(key: keyof CliConfig): string | undefined {
  const config = loadCliConfig();
  const value = config[key];
  if (typeof value === "number") return String(value);
  return value;
}
