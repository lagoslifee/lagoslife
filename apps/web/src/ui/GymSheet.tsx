import { EXERCISES, exerciseIds, GYM, type ExerciseId, type GymStatus, type Notice, type Place } from "@lagos-living/shared";
import { useEffect, useState } from "react";
import { api, naira } from "../api";

type Props = {
  place: Place;
  balance: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (notice: Notice) => void;
  /** Puts the player on the machine; false when they can't (driving, indoors). */
  onTrain: (exercise: ExerciseId, endsAt: string) => boolean;
};

const percent = (fitness: number) => `${Math.round(fitness * 100)}%`;

/** iFitness: membership, your fitness, the machines outside and who else is training. */
export function GymSheet({ place, balance, onClose, onRefresh, onToast, onTrain }: Props) {
  const [status, setStatus] = useState<GymStatus | null>(null);
  const [busy, setBusy] = useState(false);
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
              {exerciseIds.map((id) => (
                <li key={id} className="business-card">
                  <div className="business-head">
                    <span className="business-emoji">{EXERCISES[id].emoji}</span>
                    <div>
                      <strong>{EXERCISES[id].name}</strong>
                      <small className="muted">{EXERCISES[id].blurb} Uses {GYM.energyPerSet} energy.</small>
                    </div>
                  </div>
                  <div className="business-actions">
                    <button
                      className="primary"
                      disabled={busy || !member || Boolean(status.set)}
                      data-testid={`gym-${id}`}
                      onClick={() => run(async () => {
                        const set = await api.gymSet(id);
                        if (!onTrain(id, set.endsAt)) throw new Error("Get out of the car first, then start the set.");
                        onClose();
                      })}
                    >
                      Start a set
                    </button>
                  </div>
                </li>
              ))}
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
