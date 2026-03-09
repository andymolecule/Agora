import fs from "node:fs";
import path from "node:path";
import { loadIpfsConfig } from "@agora/common";
import pinataSDK from "@pinata/sdk";

function normalizeIpfsError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const directMessage =
      (typeof record.error === "string" && record.error) ||
      (typeof record.message === "string" && record.message) ||
      (typeof record.reason === "string" && record.reason);
    if (directMessage) {
      return new Error(directMessage);
    }
    const nestedError =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    const nestedMessage =
      nestedError &&
      (((typeof nestedError.reason === "string" && nestedError.reason) ||
        (typeof nestedError.message === "string" && nestedError.message) ||
        (typeof nestedError.details === "string" && nestedError.details)) ??
        null);
    if (nestedMessage) {
      return new Error(nestedMessage);
    }
    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error(String(error));
    }
  }
  return new Error(String(error));
}

function createClient() {
  const config = loadIpfsConfig();
  if (!config.AGORA_PINATA_JWT) {
    throw new Error("AGORA_PINATA_JWT is required to pin to IPFS.");
  }
  return new pinataSDK({ pinataJWTKey: config.AGORA_PINATA_JWT });
}

let cachedClient: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = createClient();
  }
  return cachedClient;
}

export async function pinJSON<T extends Record<string, unknown>>(
  name: string,
  payload: T,
): Promise<string> {
  try {
    const client = getClient();
    const result = await client.pinJSONToIPFS(payload, {
      pinataMetadata: { name },
    });
    return `ipfs://${result.IpfsHash}`;
  } catch (error) {
    throw normalizeIpfsError(error);
  }
}

export async function pinFile(
  filePath: string,
  name?: string,
): Promise<string> {
  try {
    const client = getClient();
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const stream = fs.createReadStream(filePath);
    const result = await client.pinFileToIPFS(stream, {
      pinataMetadata: { name: name ?? path.basename(filePath) },
    });
    return `ipfs://${result.IpfsHash}`;
  } catch (error) {
    throw normalizeIpfsError(error);
  }
}

export async function unpinCid(cid: string): Promise<void> {
  try {
    const client = getClient();
    const hash = cid.replace("ipfs://", "");
    await client.unpin(hash);
  } catch (error) {
    throw normalizeIpfsError(error);
  }
}

export async function pinDirectory(
  dirPath: string,
  name?: string,
): Promise<string> {
  try {
    const client = getClient();
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    const result = await client.pinFromFS(dirPath, {
      pinataMetadata: { name: name ?? path.basename(dirPath) },
    });
    return `ipfs://${result.IpfsHash}`;
  } catch (error) {
    throw normalizeIpfsError(error);
  }
}
