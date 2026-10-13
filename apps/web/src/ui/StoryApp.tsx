import { HUSTLE_FUND, loanOwed, type HustleStatus, type Notice } from "@lagos-living/shared";
import { useCallback, useEffect, useState } from "react";
import { api, naira } from "../api";

type Props = { onRefresh: () => Promise<void>; onToast: (notice: Notice) => void; onBusiness: () => void };

const STEPS = [50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 5_000_000];

/** Phone → My Story: the storyline chapters with their bonuses, and the Eko Hustle Fund starter loan. */
export function StoryApp({ onRefresh, onToast, onBusiness }: Props) {
  const [status, setStatus] = useState<HustleStatus | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.hustle());
      setFailed(null);
    } catch (error) {
      setFailed((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<{ next: HustleStatus; text: string }>) => {
    if (busy) return;
    setBusy(true);
    try {
      const { next, text } = await work();
      setStatus(next);
      onToast({ tone: "success", text });
      await onRefresh();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return failed ? (
      <div className="app-section">
        <p className="error-text small">{failed}</p>
        <button className="secondary" onClick={() => void load()}>Try again</button>
      </div>
    ) : <p className="muted">Loading your story…</p>;
  }
  const current = status.chapters.find((chapter) => !chapter.done) ?? null;
  const choices = STEPS.filter((step) => step <= status.limit);
  const chosen = amount !== null && amount <= status.limit ? amount : status.limit;
  const loan = status.loan;

  return (
    <div className="app-section business-app story-app" data-testid="story-app">
      {current && (
        <div className="business-card story-now">
          <small className="muted">CHAPTER {status.chapters.indexOf(current) + 1} OF {status.chapters.length}</small>
          <strong>{current.title}</strong>
          <p className="small">{current.story}</p>
          <p className="small"><strong>Goal:</strong> {current.goal} <span className="ok">+{naira(current.reward)} bonus</span></p>
          {current.id === "fresh" && <button className="secondary" onClick={onBusiness}>💼 Open the Business app</button>}
        </div>
      )}

      <div className="business-card" data-testid="hustle-fund">
        <div className="business-head">
          <span className="business-emoji">💰</span>
          <div>
            <strong>{HUSTLE_FUND.name}</strong>
            <small className="muted">Start your life with borrowed capital. Flat {Math.round(HUSTLE_FUND.interestRate * 100)}% fee, and {Math.round(HUSTLE_FUND.takingsShare * 100)}% of your business takings pay it back automatically.</small>
          </div>
        </div>
        {loan ? (
          <>
            <div className="loan-bar" aria-hidden="true"><i style={{ width: `${Math.round((1 - loan.remaining / loan.owed) * 100)}%` }} /></div>
            <p className="small">
              You owe <strong>{naira(loan.remaining)}</strong> of {naira(loan.owed)}.{" "}
              {loan.overdue
                ? <span className="warn">Past due: {Math.round(loan.share * 100)}% of takings now go to the fund, and you can't borrow again until it's paid.</span>
                : <>Due {new Date(loan.dueAt).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" })}.</>}
            </p>
            <div className="business-actions">
              <button className="primary" disabled={busy} onClick={() => run(async () => {
                const next = await api.repayLoan();
                return { next, text: next.loan ? `Paid ${naira(loan.remaining - next.loan.remaining)}. ${naira(next.loan.remaining)} to go.` : "Loan paid off. The Hustle Fund trusts you with more now." };
              })}>Pay back now</button>
              {loan.remaining > 50_000 && (
                <button className="secondary" disabled={busy} onClick={() => run(async () => {
                  const next = await api.repayLoan(50_000);
                  return { next, text: `Paid ${naira(50_000)} towards your loan.` };
                })}>Pay {naira(50_000)}</button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="place-chips" role="radiogroup" aria-label="How much to borrow">
              {choices.map((step) => (
                <button key={step} role="radio" aria-checked={chosen === step} className={chosen === step ? "on" : ""} onClick={() => setAmount(step)}>{naira(step)}</button>
              ))}
            </div>
            <p className="small">Borrow {naira(chosen)} now and pay back {naira(loanOwed(chosen))} within {HUSTLE_FUND.termDays} days. Pay it off to double your limit, up to {naira(HUSTLE_FUND.maxLimit)}.</p>
            <button className="primary" disabled={busy} data-testid="borrow" onClick={() => run(async () => ({ next: await api.borrow(chosen), text: `${naira(chosen)} is in your wallet. Go build something!` }))}>
              Borrow {naira(chosen)}
            </button>
          </>
        )}
      </div>

      <ol className="business-list story-chapters">
        {status.chapters.map((chapter, index) => (
          <li key={chapter.id} className={`business-card ${chapter.done ? "" : "locked"}`}>
            <div className="business-head">
              <span className="business-emoji">{chapter.claimed ? "✅" : chapter.done ? "🎁" : index === status.chapters.indexOf(current!) ? "▶" : "🔒"}</span>
              <div>
                <strong>{index + 1}. {chapter.title}</strong>
                <small className="muted">{chapter.goal}</small>
              </div>
            </div>
            {chapter.done && !chapter.claimed && (
              <button className="primary" disabled={busy} onClick={() => run(async () => ({ next: await api.claimChapter(chapter.id), text: `${chapter.title}: ${naira(chapter.reward)} bonus is yours.` }))}>
                Claim {naira(chapter.reward)}
              </button>
            )}
            {!chapter.done && <small className="muted">Bonus {naira(chapter.reward)}</small>}
          </li>
        ))}
      </ol>
      <p className="muted small">Game roleplay with fictional game naira. Nothing here is real money or a real loan.</p>
    </div>
  );
}
