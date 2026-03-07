// Skip early if required env vars are missing — check raw process.env
// because loadConfig() will throw on missing required vars.
if (
  !process.env.AGORA_SUPABASE_URL ||
  !process.env.AGORA_SUPABASE_ANON_KEY ||
  !process.env.AGORA_RPC_URL ||
  !process.env.AGORA_FACTORY_ADDRESS ||
  !process.env.AGORA_USDC_ADDRESS
) {
  console.log("SKIP: DB test requires Supabase + core env vars");
  process.exit(0);
}

const { createSupabaseClient } = await import("../index");

const db = createSupabaseClient(false);
const { data, error } = await db.from("challenges").select("id").limit(1);
if (error) {
  throw new Error(`DB query failed: ${error.message}`);
}

console.log(`PASS: DB query ok (${data?.length ?? 0} rows)`);

export {};
