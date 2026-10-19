// The "build-setup" pending interaction: replaces the composer while
// lego_setup_build waits, and asks how to staff the build.
import { useMemo, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useProviders as useProviders,
  type ExperimentalProviderModelPickerValue,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { AgentChoice, BuildSetup, SetupPayload } from "../book";
import { MinifigHead } from "./iso";
import { useOpenBuildPanel } from "./useBook";

type Choice = ExperimentalProviderModelPickerValue;

function readPayload(value: unknown): SetupPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Partial<SetupPayload>;
  if (typeof payload.bookId !== "string" || typeof payload.maxBuilders !== "number") return null;
  return payload as SetupPayload;
}

function toChoice(choice: Choice): AgentChoice {
  return {
    providerId: choice.providerId,
    model: choice.model,
    reasoningLevel: choice.reasoningLevel,
    ...(choice.serviceTier === undefined ? {} : { serviceTier: choice.serviceTier }),
  };
}

function Question({ number, title, hint, children }: { number: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="lego-q">
      <legend className="lego-q-title">
        <span className="lego-q-number" aria-hidden="true">
          {number}
        </span>
        {title}
      </legend>
      {hint === undefined ? null : <p className="lego-q-hint">{hint}</p>}
      <div className="lego-q-body">{children}</div>
    </fieldset>
  );
}

export function SetupForm({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const payload = readPayload(interaction.payload);
  const providers = useProviders();
  const fallback = useMemo<Choice | null>(() => {
    const first = providers.providers.find((provider) => (provider as { available?: boolean }).available !== false) ?? providers.providers[0];
    return first === undefined ? null : { providerId: (first as { id: string }).id, model: "", reasoningLevel: "medium" };
  }, [providers.providers]);

  const maxBuilders = Math.max(1, payload?.maxBuilders ?? 1);
  const [count, setCount] = useState(() => Math.min(maxBuilders, Math.max(1, payload?.recommendedBuilders ?? 1)));
  const [same, setSame] = useState(true);
  const [shared, setShared] = useState<Choice | null>(payload?.defaults.builder ?? null);
  const [perBuilder, setPerBuilder] = useState<Array<Choice | null>>(() =>
    Array.from({ length: maxBuilders }, () => payload?.defaults.builder ?? null),
  );
  const [master, setMaster] = useState<Choice | null>(payload?.defaults.master ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openPanel = useOpenBuildPanel();

  if (payload === null) {
    return (
      <div className="lego-setup">
        <p className="lego-error">This build setup request is malformed.</p>
        <Button variant="ghost" onClick={() => void cancel()}>
          Dismiss
        </Button>
      </div>
    );
  }

  const routing = payload.environmentId === null ? undefined : { kind: "environment" as const, environmentId: payload.environmentId };
  const sharedValue = shared ?? fallback;
  const masterValue = master ?? fallback;
  const builderChoices = same
    ? Array.from({ length: count }, () => sharedValue)
    : perBuilder.slice(0, count).map((choice) => choice ?? fallback);
  const ready = builderChoices.every((choice) => choice !== null && choice.model !== "") && masterValue !== null && masterValue.model !== "";

  const start = async () => {
    if (!ready || masterValue === null) return;
    setBusy(true);
    setError(null);
    const value: BuildSetup = {
      sameForAll: same,
      builders: builderChoices.map((choice) => toChoice(choice as Choice)),
      master: toChoice(masterValue),
    };
    try {
      // Open the workbench on the user's own click; the form unmounts once
      // the answer lands, and the panel picks the build up as it starts.
      openPanel({ id: payload.bookId, setNumber: payload.setNumber });
      await submit(value as unknown as Parameters<typeof submit>[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const counts = Array.from({ length: maxBuilders }, (_, index) => index + 1);

  return (
    <form
      className="lego-setup"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <header className="lego-setup-head">
        <div className="lego-badge lego-badge-small" aria-hidden="true">
          <span>LEGO BUILD</span>
        </div>
        <div className="lego-setup-title">
          <strong>
            Set {payload.setNumber} · {payload.title}
          </strong>
          <span>
            {payload.bagCount} bag{payload.bagCount === 1 ? "" : "s"} · {payload.pieceCount} pieces · up to {payload.parallelWidth} bag{payload.parallelWidth === 1 ? "" : "s"} at once
          </span>
        </div>
      </header>
      {payload.note === null ? null : <p className="lego-setup-note">{payload.note}</p>}

      <Question
        number={1}
        title="How many builder agents?"
        hint={`Recommended: ${payload.recommendedBuilders}. More than ${payload.parallelWidth} will wait on dependencies; builders pick up the next bag when they finish.`}
      >
        <div className="lego-count" role="radiogroup" aria-label="Number of builders">
          {counts.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={count === value}
              className={`lego-count-option${count === value ? " lego-count-on" : ""}`}
              onClick={() => setCount(value)}
            >
              {value}
              {value === payload.recommendedBuilders ? <span className="lego-count-star" title="Recommended">★</span> : null}
            </button>
          ))}
        </div>
        <div className="lego-lineup" aria-hidden="true">
          {Array.from({ length: count }, (_, index) => (
            <span key={index} className="lego-lineup-head" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
              <MinifigHead size={22} />
            </span>
          ))}
          <span className="lego-lineup-plus">+</span>
          <span className="lego-lineup-head lego-lineup-master">
            <MinifigHead master size={24} />
          </span>
        </div>
      </Question>

      <Question number={2} title="Should every builder run the same provider and model?">
        <div className="lego-toggle" role="radiogroup" aria-label="Same model for all builders">
          <button type="button" role="radio" aria-checked={same} className={same ? "lego-toggle-on" : undefined} onClick={() => setSame(true)}>
            Yes, same for all
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!same}
            className={!same ? "lego-toggle-on" : undefined}
            onClick={() => {
              setSame(false);
              setPerBuilder((current) => current.map((choice) => choice ?? sharedValue));
            }}
          >
            No, choose per builder
          </button>
        </div>
      </Question>

      <Question number={3} title={same ? "Which provider and model should the builders use?" : "Which provider and model for each builder?"}>
        {same ? (
          sharedValue === null ? (
            <p className="lego-q-hint">Loading providers…</p>
          ) : (
            <ProviderModelPicker value={sharedValue} onChange={setShared} {...(routing ? { routing } : {})} />
          )
        ) : (
          <ul className="lego-builder-list">
            {Array.from({ length: count }, (_, index) => {
              const value = perBuilder[index] ?? sharedValue;
              return (
                <li key={index}>
                  <MinifigHead size={18} />
                  <span className="lego-builder-name">Builder {index + 1}</span>
                  {value === null ? (
                    <span className="lego-q-hint">Loading providers…</span>
                  ) : (
                    <ProviderModelPicker
                      value={value}
                      onChange={(next) =>
                        setPerBuilder((current) => current.map((choice, position) => (position === index ? next : choice)))
                      }
                      {...(routing ? { routing } : {})}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Question>

      <Question number={4} title="Which provider and model should run the Master Builder?" hint="The Master Builder integrates every bag and fixes the seams, so a strong model pays off here.">
        <div className="lego-master-row">
          <MinifigHead master size={20} />
          {masterValue === null ? (
            <span className="lego-q-hint">Loading providers…</span>
          ) : (
            <ProviderModelPicker value={masterValue} onChange={setMaster} {...(routing ? { routing } : {})} />
          )}
        </div>
      </Question>

      {error === null ? null : <p className="lego-error">{error}</p>}
      <footer className="lego-setup-actions">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void cancel()}>
          Not now
        </Button>
        <Button type="submit" disabled={!ready || busy}>
          {busy ? "Starting…" : `Start building with ${count} builder${count === 1 ? "" : "s"}`}
        </Button>
      </footer>
    </form>
  );
}
