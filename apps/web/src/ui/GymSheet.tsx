import { EXERCISES, exerciseIds, GYM, LIFTS, maxLiftKg, setEnergyCost, staminaFactor, type ExerciseId, type GymStatus, type Notice, type Place } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira } from "../api";

type Props = {
  place: Place;
  balance: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  /** Puts the player on the machine; false when they can't (not inside the gym). */
  onTrain: (exercise: ExerciseId, endsAt: string) => boolean;
};

const percent = (fitness: number) => `${Math.round(fitness * 100)}%`;

/** iFitness front desk: membership, your fitness and stamina, the machines and who else is training. */
export function GymSheet({ place, balance, onClose, onRefresh, onToast, onTrain }: Props) {
  const [status, setStatus] = useState<GymStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosenKg, setChosenKg] = useState<Partial<Record<ExerciseId, number>>>({});
  const load = () => api.gym().then(setStatus).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const member = Boolean(status?.memberUntil);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet gym-sheet" role="dialog" aria-label={place.name} data-testid="gym-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">GYM · {place.street.toUpperCase()}</p>
            <h2>{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {!status ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="gym-fitness">
              <span>Your fitness</span>
              <div className="gym-bar"><i style={{ width: percent(status.fitness) }} /></div>
              <strong>{percent(status.fitness)}</strong>
            </div>
            <p className="muted small">
              Your body follows your training: you start with an ordinary build and get more muscular with every set you finish. Skip the gym for more
              than {GYM.graceDays} days and it slowly fades.
            </p>
            <div className="gym-fitness">
              <span>Stamina bonus</span>
              <div className="gym-bar"><i style={{ width: percent((1 - staminaFactor(status.fitness)) / GYM.staminaAtFullFitness) }} /></div>
              <strong>+{Math.round((1 - staminaFactor(status.fitness)) * 100)}%</strong>
            </div>
            <p className="muted small">
              Every set uses energy; cardio uses the most. The fitter you get, the less each set, shift and delivery tires you: up to{" "}
              {Math.round(GYM.staminaAtFullFitness * 100)}% less at full fitness. Your energy is {status.energy}/100.
            </p>
            {member ? (
              <p className="small">✅ Member until {new Date(status.memberUntil!).toLocaleDateString()}</p>
            ) : (
              <div className="business-card">
                <strong>Monthly membership · {naira(GYM.monthlyFee)}</strong>
                <small className="muted">{GYM.membershipDays} days of training on every machine.</small>
                <div className="business-actions">
                  <button
                    className="primary"
                    disabled={busy || balance < GYM.monthlyFee}
                    data-testid="gym-join"
                    onClick={() => run(async () => {
                      await api.gymJoin();
                      onToast({ tone: "success", text: `Welcome to ${GYM.name}! Pick a machine to start.` });
                      await Promise.all([load(), onRefresh()]);
                    })}
                  >
                    Join · {naira(GYM.monthlyFee)}
                  </button>
                </div>
              </div>
            )}
            <h3>Machines</h3>
            <ul className="business-list">
              {exerciseIds.map((id) => {
                const lift = LIFTS[id];
                const limit = maxLiftKg(id, status.fitness);
                const kg = lift ? Math.min(chosenKg[id] ?? limit!, limit!) : undefined;
                const cost = setEnergyCost(id, status.fitness, kg);
                return (
                <li key={id} className="business-card">
                  <div className="business-head">
                    <span className="business-emoji">{EXERCISES[id].emoji}</span>
                    <div>
                      <strong>{EXERCISES[id].name}</strong>
                      <small className="muted">{EXERCISES[id].blurb} Uses {cost} energy{!lift && cost < EXERCISES[id].energy ? ` (${EXERCISES[id].energy} when untrained)` : ""}.</small>
                    </div>
                  </div>
                  {lift && (
                    <div className="gym-weights" role="group" aria-label={`${EXERCISES[id].name} weight`}>
                      <small className="muted">
                        Weight · {kg} {lift.unit}. Your limit is {limit} kg; it rises as you train (up to {lift.trained} kg). Heavier sets build more.
                      </small>
                      <div className="studio-chips">
                        {lift.weights.map((option) => (
                          <button
                            key={option}
                            type="button"
                            disabled={option > limit!}
                            aria-pressed={option === kg}
                            data-testid={`gym-${id}-${option}`}
                            title={option > limit! ? "Too heavy for you yet: keep training" : undefined}
                            onClick={() => setChosenKg((current) => ({ ...current, [id]: option }))}
                          >
                            {option > limit! ? "🔒 " : ""}{option} kg
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="business-actions">
                    <button
                      className="primary"
                      disabled={busy || !member || Boolean(status.set)}
                      data-testid={`gym-${id}`}
                      onClick={() => run(async () => {
                        const set = await api.gymSet(id, kg);
                        if (!onTrain(id, set.endsAt)) throw new Error(`Go inside ${GYM.name} and walk up to the machine first.`);
                        onClose();
                      })}
                    >
                      {kg ? `Start a set · ${kg} kg` : "Start a set"}
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
            <h3>Training here now</h3>
            {status.peopleHere.length ? (
              <ul className="gym-people">
                {status.peopleHere.map((name) => <li key={name}>💪 {name}</li>)}
              </ul>
            ) : (
              <p className="muted small">Nobody else right now. When other residents train here you'll see them on the machines and can say hi in chat.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
