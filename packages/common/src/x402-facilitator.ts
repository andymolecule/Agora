export interface X402PaymentResource {
  method: string;
  path: string;
  payTo: string;
  priceUsd: number;
}

export interface VerifyAndSettleX402PaymentInput {
  facilitatorUrl: string;
  paymentHeader: string;
  network: string;
  resource: X402PaymentResource;
  fetchImpl?: typeof fetch;
}

type HeaderValue = string | string[] | undefined | null;

export function extractX402PaymentHeader(
  getHeader: (name: string) => HeaderValue,
): string | null {
  const headerNames = ["x-payment", "x-payment-response", "x-402-payment"];
  for (const headerName of headerNames) {
    const raw = getHeader(headerName);
    if (!raw) continue;
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (typeof first === "string" && first.trim().length > 0) return first;
      continue;
    }
    if (raw.trim().length > 0) return raw;
  }
  return null;
}

function truthyResult(
  payload: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => payload[key] === true);
}

async function postFacilitatorJson(
  input: {
    baseUrl: string;
    action: "verify" | "settle";
    body: Record<string, unknown>;
  },
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${input.baseUrl}/${input.action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.body),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function verifyAndSettleX402Payment(
  input: VerifyAndSettleX402PaymentInput,
): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.facilitatorUrl.replace(/\/$/, "");
  const requestPayload = {
    payment: input.paymentHeader,
    network: input.network,
    resource: {
      method: input.resource.method,
      path: input.resource.path,
      payTo: input.resource.payTo,
      priceUsd: input.resource.priceUsd,
    },
  };

  const verifyPayload = await postFacilitatorJson(
    {
      baseUrl,
      action: "verify",
      body: requestPayload,
    },
    fetchImpl,
  );
  if (!verifyPayload) return false;
  if (!truthyResult(verifyPayload, ["ok", "verified", "valid"])) return false;

  const settlePayload = await postFacilitatorJson(
    {
      baseUrl,
      action: "settle",
      body: requestPayload,
    },
    fetchImpl,
  );
  if (!settlePayload) return false;
  return truthyResult(settlePayload, ["ok", "settled", "success"]);
}
