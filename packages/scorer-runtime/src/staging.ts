import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WAD_SCALE = 1_000_000_000_000_000_000n;
const WAD_DECIMALS = 18;

function expandNumberString(value: string) {
  const trimmed = value.trim().toLowerCase();
  const [rawMantissaPart = trimmed, exponentPart] = trimmed.split("e");
  const exponent = exponentPart ? Number.parseInt(exponentPart, 10) : 0;

  if (!Number.isFinite(exponent)) {
    throw new Error(`Invalid score value: ${value}`);
  }

  const [whole = "0", fractional = ""] = rawMantissaPart.split(".");
  const digits = `${whole}${fractional}`.replace(/^0+$/, "0");
  const decimalIndex = whole.length + exponent;

  if (decimalIndex <= 0) {
    return {
      wholePart: "0",
      fractionalPart: `${"0".repeat(Math.abs(decimalIndex))}${digits}`,
    };
  }

  if (decimalIndex >= digits.length) {
    return {
      wholePart:
        `${digits}${"0".repeat(decimalIndex - digits.length)}`.replace(
          /^0+(?=\d)/,
          "",
        ) || "0",
      fractionalPart: "",
    };
  }

  return {
    wholePart: digits.slice(0, decimalIndex).replace(/^0+(?=\d)/, "") || "0",
    fractionalPart: digits.slice(decimalIndex),
  };
}

function roundFractionalDigits(
  wholePart: string,
  fractionalPart: string,
  scale: number,
) {
  if (fractionalPart.length <= scale) {
    return {
      wholePart,
      fractionalPart: fractionalPart.padEnd(scale, "0"),
    };
  }

  const retained = fractionalPart.slice(0, scale);
  const nextDigit = fractionalPart[scale] ?? "0";
  if (nextDigit < "5") {
    return {
      wholePart,
      fractionalPart: retained,
    };
  }

  const roundedFractional = BigInt(retained || "0") + 1n;
  if (roundedFractional === WAD_SCALE) {
    return {
      wholePart: (BigInt(wholePart || "0") + 1n).toString(),
      fractionalPart: "0".repeat(scale),
    };
  }

  return {
    wholePart,
    fractionalPart: roundedFractional.toString().padStart(scale, "0"),
  };
}

export async function createScoringWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agora-score-"));
  const inputDir = path.join(root, "input");
  await fs.mkdir(inputDir, { recursive: true });
  return { root, inputDir };
}

export function scoreToWad(score: number): bigint {
  if (!Number.isFinite(score) || score < 0) {
    throw new Error(`Invalid score value: ${score}`);
  }

  const expanded = expandNumberString(score.toString());
  const rounded = roundFractionalDigits(
    expanded.wholePart,
    expanded.fractionalPart,
    WAD_DECIMALS,
  );
  const wholePart = BigInt(rounded.wholePart || "0");
  const fractionalPart = BigInt(rounded.fractionalPart || "0");
  return wholePart * WAD_SCALE + fractionalPart;
}

export function wadToScore(wad: string | number | bigint): number {
  if (typeof wad === "string" && wad.includes(".")) {
    return Number(wad);
  }
  const value = typeof wad === "bigint" ? wad : BigInt(wad);
  const whole = value / WAD_SCALE;
  const fractional = value % WAD_SCALE;
  const asString = `${whole}.${fractional.toString().padStart(18, "0")}`;
  return Number(asString);
}

export async function cleanupWorkspace(root: string) {
  try {
    await fs.rm(root, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
