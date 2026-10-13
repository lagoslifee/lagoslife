import { EXERCISES, exerciseIds, GYM, LIFTS, maxLiftKg, setEnergyCost, staminaFactor, type ExerciseId, type GymStatus, type Notice, type Place } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira } from "../api";

type Props = {
  place: Place;
  balance: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  /** Puts the player on the machine with that weight and effort (0..1 of their limit); false when they can't (not inside the gym). */
  onTrain: (exercise: ExerciseId, endsAt: string, kg: number | null, strain: number) => boolean;
  /** The trainer you hired walks over (or goes home with null). */
  onTrainer: (until: string | null) => void;
};

const percent = (fitness: number) => `${Math.round(fitness * 100)}%`;

/** iFitness front desk: membership, your fitness and stamina, the machines and who else is training. */
/** What's on each side of a 20 kg bar, e.g. "20 + 10 a side". */
function plateHint(kg: number) {
  const side = (kg - 20) / 2;
  if (side <= 0) return "the empty 20 kg bar";
  const plates: number[] = [];
  let left = side;
  for (const plate of [25, 20, 15, 10, 5, 2.5]) {
    while (left >= plate - 1e-9) {
      plates.push(plate);
      left -= plate;
    }
  }
  return `20 kg bar + ${plates.join(" + ")} a side`;
}

export function GymSheet({ place, balance, onClose, onRefresh, onToast, onTrain, onTrainer }: Props) {
  const [status, setStatus] = useState<GymStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosenKg, setChosenKg] = useState<Partial<Record<ExerciseId, number>>>({});
  const load = () =>
    api.gym()
      .then((next) => {
        setStatus(next);
        onTrainer(next.trainerUntil);
      })
      .catch(() => undefined);
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
  const coached = Boolean(status?.trainerUntil && Date.parse(status.trainerUntil) > Date.now());
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
            {member && (
              <div className="business-card gym-trainer" data-testid="gym-trainer">
                <strong>🧑🏾‍🏫 Personal trainer · {GYM.trainer.name}</strong>
                {coached ? (
                  <small>
                    {GYM.trainer.name} is with you until {new Date(status.trainerUntil!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: he counts
                    every rep, spots you one weight above your limit, and each set builds {Math.round(GYM.trainer.gainBonus * 100)}% more.
                  </small>
                ) : (
                  <>
                    <small className="muted">
                      An hour with a coach: he stands by your machine and counts your reps, spots you so you can go one weight heavier, and every set builds{" "}
                      {Math.round(GYM.trainer.gainBonus * 100)}% more fitness.
                    </small>
                    <div className="business-actions">
                      <button
                        className="primary"
                        disabled={busy || balance < GYM.trainer.fee}
                        data-testid="gym-hire-trainer"
                        onClick={() => run(async () => {
                          const hired = await api.gymTrainer();
                          onTrainer(hired.trainerUntil);
                          onToast({ tone: "success", text: hired.charged ? `${GYM.trainer.name} is on his way over. Pick a machine and he'll spot you.` : `${GYM.trainer.name} is already training you.` });
                          await Promise.all([load(), onRefresh()]);
                        })}
                      >
                        Hire for an hour · {naira(GYM.trainer.fee)}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <h3>Machines</h3>
            <ul className="business-list">
              {exerciseIds.map((id) => {
                const lift = LIFTS[id];
                const limit = maxLiftKg(id, status.fitness, coached);
                const kg = lift ? Math.max(lift.weights[0]!, Math.min(chosenKg[id] ?? maxLiftKg(id, status.fitness)!, limit!)) : undefined;
                const strain = lift && kg ? Math.max(0, Math.min(1, (kg - lift.weights[0]!) / Math.max(1, limit! - lift.weights[0]!))) : 0;
                const current = status.set?.exercise === id;
                const choose = (next: number) => setChosenKg((chosen) => ({ ...chosen, [id]: Math.max(lift!.weights[0]!, Math.min(limit!, next)) }));
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
                      <div className="gym-stepper">
                        <button type="button" aria-label="Lighter" data-testid={`gym-${id}-less`} disabled={kg! <= lift.weights[0]!} onClick={() => choose(kg! - lift.step)}>−</button>
                        <div>
                          <strong data-testid={`gym-${id}-kg`}>{kg} kg</strong>
                          <small className="muted">{id === "dumbbells" ? "in each hand" : plateHint(kg!)}</small>
                        </div>
                        <button type="button" aria-label="Heavier" data-testid={`gym-${id}-more`} disabled={kg! >= limit!} onClick={() => choose(kg! + lift.step)}>+</button>
                      </div>
                      <input
                        type="range"
                        min={lift.weights[0]}
                        max={limit!}
                        step={lift.step}
                        value={kg}
                        aria-label={`${EXERCISES[id].name} kg`}
                        onChange={(event) => choose(Number(event.target.value))}
                      />
                      <small className="muted">
                        Your limit is {limit} kg{coached ? " with your trainer spotting" : ""}; it rises as you train (up to {lift.trained} kg). Heavier sets build more and
                        tire you more.
                      </small>
                    </div>
                  )}
                  <div className="business-actions">
                    <button
                      className="primary"
                      disabled={busy || !member}
                      data-testid={`gym-${id}`}
                      onClick={() => run(async () => {
                        const set = await api.gymSet(id, kg);
                        if (!onTrain(id, set.endsAt, set.kg, strain)) throw new Error(`Go inside ${GYM.name} and walk up to the machine first.`);
                        onClose();
                      })}
                    >
                      {current ? "Restart this set" : status.set ? "Switch to this" : "Start a set"}{kg ? ` · ${kg} kg` : ""}
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
