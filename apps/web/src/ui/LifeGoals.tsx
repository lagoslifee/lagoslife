import { INTERESTS, LIFE_GOALS, PLAYSTYLES, type LifeGoals } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api } from "../api";

type Props = { playerName: string; onClose: () => void };

const EMPTY: LifeGoals = { goals: [], interests: [], playstyle: null, dream: "", skipped: false };

/** "Your Lagos story": what the resident wants from this life, asked once after sign-up and editable from Settings. */
export function LifeGoalsDialog({ playerName, onClose }: Props) {
  const [answers, setAnswers] = useState<LifeGoals>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void api.goals().then(({ goals }) => goals && !goals.skipped && setAnswers(goals)).catch(() => undefined);
  }, []);

  const toggle = <K extends "goals" | "interests">(key: K, id: LifeGoals[K][number]) =>
    setAnswers((current) => {
      const list = current[key] as string[];
      return { ...current, [key]: list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id] };
    });

  const save = async (skipped: boolean) => {
    setSaving(true);
    setError("");
    try {
      await api.saveGoals(skipped ? { ...EMPTY, skipped: true } : { ...answers, skipped: false });
      localStorage.removeItem("lagos-new-account");
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop goals-backdrop">
      <section className="goals-card" role="dialog" aria-modal="true" aria-label="Your Lagos story" data-testid="life-goals">
        <p className="step-label">WELCOME TO NAIJA WORLD</p>
        <h2>What's your Lagos story, {playerName}?</h2>
        <p className="muted">Tell us what you want from this life. It's saved to your account, and you can change it any time in Phone → Settings.</p>

        <h3>Your goals <small>pick as many as you like</small></h3>
        <div className="goal-grid">
          {LIFE_GOALS.map((goal) => (
            <button key={goal.id} type="button" className="goal-chip" aria-pressed={answers.goals.includes(goal.id)} onClick={() => toggle("goals", goal.id)}>
              <span>{goal.emoji}</span>{goal.label}
            </button>
          ))}
        </div>

        <h3>Your life dream</h3>
        <textarea
          maxLength={280}
          rows={3}
          value={answers.dream}
          onChange={(event) => setAnswers({ ...answers, dream: event.target.value })}
          placeholder="e.g. Build a house on the lagoon for my mum and open my own restaurant in VI."
          aria-label="Your life dream"
        />
        <small className="field-hint">{280 - answers.dream.length} characters left · private, only you see this</small>

        <h3>What are you into?</h3>
        <div className="interest-row">
          {INTERESTS.map((interest) => (
            <button key={interest.id} type="button" className="interest-chip" aria-pressed={answers.interests.includes(interest.id)} onClick={() => toggle("interests", interest.id)}>
              {interest.emoji} {interest.label}
            </button>
          ))}
        </div>

        <h3>How do you like to play?</h3>
        <div className="playstyle-grid">
          {PLAYSTYLES.map((style) => (
            <button key={style.id} type="button" className="playstyle-card" aria-pressed={answers.playstyle === style.id} onClick={() => setAnswers({ ...answers, playstyle: answers.playstyle === style.id ? null : style.id })}>
              <span>{style.emoji}</span>
              <strong>{style.label}</strong>
              <small>{style.blurb}</small>
            </button>
          ))}
        </div>

        {error && <p className="form-message" role="status">{error}</p>}
        <div className="goals-actions">
          <button type="button" className="secondary" disabled={saving} onClick={() => void save(true)}>Maybe later</button>
          <button type="button" className="primary" disabled={saving || (!answers.goals.length && !answers.dream.trim())} onClick={() => void save(false)}>
            {saving ? "Saving…" : "Start my story"}
          </button>
        </div>
      </section>
    </div>
  );
}
