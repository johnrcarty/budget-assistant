"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyAiSuggestions,
  getAiSuggestions,
} from "@/server/actions/categorization";
import type { AiSuggestion } from "@/server/lib/ai-categorize";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "text-primary",
  medium: "text-muted-foreground",
  low: "text-amber-600 dark:text-amber-400",
};

export function AiSuggestPanel({ hasApiKey }: { hasApiKey: boolean }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!hasApiKey) {
    return (
      <p className="text-sm text-muted-foreground">
        Set <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code> in the
        app&rsquo;s environment to enable AI suggestions (Claude Haiku categorizes
        merchants in bulk; you review before anything is applied).
      </p>
    );
  }

  const fetchSuggestions = () =>
    startTransition(async () => {
      setStatus(null);
      try {
        const result = await getAiSuggestions();
        setSuggestions(result.suggestions);
        setRemaining(result.remainingMerchants);
        // Preselect everything the model was confident about.
        setAccepted(
          new Set(
            result.suggestions
              .filter((s) => s.option && s.confidence !== "low")
              .map((s) => s.merchant.key),
          ),
        );
        if (result.suggestions.length === 0) {
          setStatus("Nothing left to suggest - all uncategorized merchants are covered.");
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Getting suggestions failed.");
      }
    });

  const apply = () =>
    startTransition(async () => {
      if (!suggestions) return;
      const items = suggestions
        .filter((s) => s.option && accepted.has(s.merchant.key))
        .map((s) => ({
          pattern: s.pattern,
          kind: s.option!.kind,
          templateId: s.option!.templateId,
        }));
      if (items.length === 0) return;
      try {
        const result = await applyAiSuggestions(items);
        setSuggestions(null);
        setStatus(
          `Created ${result.rulesCreated} rules and categorized ${result.matched} transactions.`,
        );
        router.refresh();
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Applying suggestions failed.");
      }
    });

  const toggle = (key: string) =>
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const acceptedCount = suggestions
    ? suggestions.filter((s) => s.option && accepted.has(s.merchant.key)).length
    : 0;

  return (
    <div className="flex flex-col gap-3">
      {suggestions === null ? (
        <div className="flex items-center gap-3">
          <Button onClick={fetchSuggestions} disabled={pending} size="sm">
            <Sparkles className="size-4" />
            {pending ? "Asking Haiku…" : "Suggest categories"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Groups your uncategorized transactions by merchant and asks Claude Haiku
            to propose rules. Nothing is applied until you approve.
          </span>
        </div>
      ) : suggestions.length > 0 ? (
        <>
          <div>
            {suggestions.map((s) => {
              const isAccepted = s.option !== null && accepted.has(s.merchant.key);
              return (
                <label
                  key={s.merchant.key}
                  className={`flex items-start gap-3 border-b py-2.5 last:border-b-0 ${
                    s.option === null ? "opacity-50" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={s.option === null}
                    checked={isAccepted}
                    onChange={() => toggle(s.merchant.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {s.merchant.key.toLowerCase()}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {s.merchant.count}× · {usd(Math.abs(s.merchant.totalCents))}{" "}
                      {s.merchant.totalCents >= 0 ? "in" : "out"} → {" "}
                      {s.option ? (
                        <>
                          <span className="text-foreground">{s.option.label}</span>{" "}
                          <span className={CONFIDENCE_STYLE[s.confidence]}>
                            ({s.confidence})
                          </span>
                        </>
                      ) : (
                        "skip"
                      )}
                    </span>
                    {s.option && (
                      <span className="block text-xs text-muted-foreground">
                        rule: description contains &ldquo;{s.pattern}&rdquo;
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={apply} disabled={pending || acceptedCount === 0} size="sm">
              {pending
                ? "Applying…"
                : `Apply ${acceptedCount} ${acceptedCount === 1 ? "rule" : "rules"}`}
            </Button>
            <Button onClick={() => setSuggestions(null)} variant="outline" size="sm">
              Discard
            </Button>
            {remaining > 0 && (
              <span className="text-xs text-muted-foreground">
                {remaining} more merchants after this batch
              </span>
            )}
          </div>
        </>
      ) : null}
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
    </div>
  );
}
