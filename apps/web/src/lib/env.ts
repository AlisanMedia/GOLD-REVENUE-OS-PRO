import { parsePublicEnv, parseServerEnv } from "@gold-revenue-os/config";

const rawPublicEnv = () => ({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

export function publicEnv() { return parsePublicEnv(rawPublicEnv()); }
export function serverEnv() { return parseServerEnv({ ...rawPublicEnv(), NODE_ENV: process.env.NODE_ENV }); }
