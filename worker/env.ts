import { ENV_DEFAULTS } from "./env-defaults";
import { Env } from "./types";

export function getEnv(env: Env, key: string, fallback: string = ""): string {
  const val = (env as any)[key];
  if (val !== undefined && val !== null && String(val).trim() !== "") {
    return String(val).trim();
  }
  const defaultVal = (ENV_DEFAULTS as any)[key];
  if (defaultVal !== undefined && defaultVal !== null && String(defaultVal).trim() !== "") {
    return String(defaultVal).trim();
  }
  return fallback;
}

export { ENV_DEFAULTS };
