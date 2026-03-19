import { NextResponse } from "next/server";
import {
  AUTHORING_REVIEW_HEADER_NAME,
  buildAuthoringReviewUpstreamUrl,
  resolveAuthoringReviewProxy,
} from "../../../../../../lib/authoring-review-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: { id: string } },
) {
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
    draftId: context.params.id,
  });

  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AUTHORING_REVIEW_HEADER_NAME]: reviewToken,
    },
    body: await request.text(),
    cache: "no-store",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}
