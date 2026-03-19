"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function PostError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-24">
      <section className="rounded-[2px] border-2 border-warm-900 bg-white p-6 shadow-[4px_4px_0px_var(--color-warm-900)]">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] bg-warm-900 text-white">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-3">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-warm-500">
                Agora · Post
              </div>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-warm-900">
                Posting flow hit an unexpected error
              </h1>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-warm-700">
              The local draft is still available. Next step: retry this screen
              or restart the posting flow if the error keeps happening.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-[2px] border-2 border-warm-900 bg-warm-900 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white shadow-[3px_3px_0px_var(--color-warm-900)] transition hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_var(--color-warm-900)] motion-reduce:transform-none motion-reduce:transition-none"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </button>
              <Link
                href="/post"
                className="inline-flex items-center gap-2 rounded-[2px] border border-warm-300 bg-warm-50 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-warm-700 transition hover:border-warm-900 hover:text-warm-900 motion-reduce:transition-none"
              >
                Restart flow
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
