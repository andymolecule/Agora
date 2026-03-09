// Skip early if Pinata auth is missing.
if (!process.env.AGORA_PINATA_JWT) {
  console.log("SKIP: IPFS test requires AGORA_PINATA_JWT");
  process.exit(0);
}

const { pinJSON } = await import("../pin");
const { getJSON } = await import("../fetch");

const payload = {
  hello: "world",
  timestamp: new Date().toISOString(),
};

const name = `agora-test-${Date.now()}`;
const cid = await pinJSON(name, payload);
const fetched = await getJSON<typeof payload>(cid);

if (fetched.hello !== payload.hello) {
  throw new Error("IPFS round-trip failed: payload mismatch");
}

console.log("PASS: IPFS round-trip test");

export {};
