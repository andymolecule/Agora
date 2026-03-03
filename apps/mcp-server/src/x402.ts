import type { IncomingMessage, ServerResponse } from "node:http";
import {
  extractX402PaymentHeader,
  readX402RuntimeConfig,
  verifyAndSettleX402Payment,
} from "@hermes/common";

const MCP_SESSION_PRICE_USD = 0.01;
let x402ConfigLogged = false;

export function getMcpX402Metadata() {
  const config = readX402RuntimeConfig();
  return {
    enabled: config.enabled,
    reportOnly: config.reportOnly,
    network: config.network,
    facilitatorUrl: config.facilitatorUrl,
    payTo: config.payTo,
    routes: [
      {
        id: "mcp-session",
        method: "POST",
        path: "/mcp",
        priceUsd: MCP_SESSION_PRICE_USD,
        description: "Fee per MCP session bootstrap.",
      },
    ],
  };
}

export async function enforceMcpSessionPayment(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const config = readX402RuntimeConfig();

  if (!x402ConfigLogged) {
    console.info(
      `[x402][mcp] enabled=${config.enabled} reportOnly=${config.reportOnly} facilitator=${config.facilitatorUrl} network=${config.network} payTo=${config.payTo}`,
    );
    x402ConfigLogged = true;
  }

  if (!config.enabled) return true;

  if (config.reportOnly) {
    console.info(
      `[x402][report-only] would charge route=mcp-session method=${req.method ?? "UNKNOWN"} path=/mcp price=$${MCP_SESSION_PRICE_USD.toFixed(2)}`,
    );
    return true;
  }

  const header = extractX402PaymentHeader((name) => req.headers[name]);
  if (!header) {
    const metadata = getMcpX402Metadata();
    res.statusCode = 402;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "Payment Required",
        payment: {
          protocol: "x402",
          network: metadata.network,
          payTo: metadata.payTo,
          route: "/mcp",
          method: req.method ?? "POST",
          priceUsd: MCP_SESSION_PRICE_USD,
        },
      }),
    );
    return false;
  }

  const ok = await verifyAndSettleX402Payment({
    facilitatorUrl: config.facilitatorUrl,
    paymentHeader: header,
    network: config.network,
    resource: {
      method: req.method ?? "POST",
      path: "/mcp",
      payTo: config.payTo,
      priceUsd: MCP_SESSION_PRICE_USD,
    },
  });

  if (ok) return true;

  res.statusCode = 402;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Payment verification failed." }));
  return false;
}
