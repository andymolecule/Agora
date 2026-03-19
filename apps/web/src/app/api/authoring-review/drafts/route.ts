import { NextResponse } from "next/server";
import {
  AUTHORING_REVIEW_HEADER_NAME,
  buildAuthoringReviewUpstreamUrl,
  resolveAuthoringReviewProxy,
} from "../../../../lib/authoring-review-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const resolved = resolveAuthoringReviewProxy(request.url);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: 503 });
  }

  const reviewToken = request.headers.get(AUTHORING_REVIEW_HEADER_NAME);
  if (!reviewToken) {
    return NextResponse.json(
      {
        error:
          "Authoring review token missing. Next step: enter the operator review token and retry.",
      },
      { status: 401 },
    );
  }

  const upstreamUrl = buildAuthoringReviewUpstreamUrl({
    baseUrl: resolved.baseUrl,
    requestUrl: request.url,
  });

  const upstream = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      [AUTHORING_REVIEW_HEADER_NAME]: reviewToken,
    },
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}
