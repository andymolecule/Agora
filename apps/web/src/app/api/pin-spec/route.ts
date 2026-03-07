import { API_BASE_URL } from "../../../lib/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxy(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const origin = request.headers.get("origin");
  const upstream = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/pin-spec`, {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(realIp ? { "x-real-ip": realIp } : {}),
      ...(origin ? { origin } : {}),
    },
    body: request.method === "GET" ? undefined : await request.text(),
    cache: "no-store",
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(request: Request) {
  return proxy(request);
}

export async function POST(request: Request) {
  return proxy(request);
}
