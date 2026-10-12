import { BUSINESS, BUSINESS_TYPES, COURSES, businessTypeIds, courseIds, type BusinessStatus, type BusinessTypeId, type Notice } from "@lagos-living/shared";
import { useCallback, useEffect, useState } from "react";
import { api, naira } from "../api";

type Props = { onRefresh: () => Promise<void>; onToast: (notice: Notice) => void };

/** Phone → Business: register businesses, collect their takings, upgrade them, and study for certificates. */
export function BusinessApp({ onRefresh, onToast }: Props) {
  const [tab, setTab] = useState<"mine" | "start" | "school">("mine");
  const [status, setStatus] = useState<BusinessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<BusinessTypeId | null>(null);
  const [name, setName] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setStatus(await api.business());
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    }
  }, [onToast]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void load();
    }, 10_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [load]);

  const run = async (work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    try {
      onToast({ tone: "success", text: await work() });
      await Promise.all([load(), onRefresh()]);
    } catch (error) {
      onToast({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className="muted">Loading…</p>;
  const owned = new Set(status.businesses.map((entry) => entry.type));
  const studying = status.courses.find((course) => new Date(course.endsAt).getTime() > now);
  const certified = new Set(status.certificates.concat(status.courses.filter((course) => new Date(course.endsAt).getTime() <= now).map((course) => course.course)));
  const totalPerHour = status.businesses.reduce((sum, entry) => sum + entry.perHour, 0);

  return (
    <div className="app-section business-app" data-testid="business-app">
      <div className="place-chips" role="tablist">
        <button role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>My businesses {status.businesses.length || ""}</button>
        <button role="tab" aria-selected={tab === "start"} className={tab === "start" ? "on" : ""} onClick={() => setTab("start")}>Start one</button>
        <button role="tab" aria-selected={tab === "school"} className={tab === "school" ? "on" : ""} onClick={() => setTab("school")}>🎓 School</button>
      </div>

      {tab === "mine" && (
        <>
          {status.businesses.length === 0 ? (
            <p className="muted small">You don't run a business yet. Tap <strong>Start one</strong>: a POS kiosk needs no certificate.</p>
          ) : (
            <p className="muted small">Takings pile up for {BUSINESS.storeHours} hours, then stop until you collect. Together you earn {naira(totalPerHour)} an hour.</p>
          )}
          <ul className="business-list">
            {status.businesses.map((entry) => {
              const spec = BUSINESS_TYPES[entry.type];
              return (
                <li key={entry.id} className="business-card">
                  <div className="business-head">
                    <span className="business-emoji">{spec.emoji}</span>
                    <div>
                      <strong>{entry.name}</strong>
                      <small className="muted">{spec.name} · level {entry.level} · {naira(entry.perHour)}/h</small>
                    </div>
                  </div>
                  <div className="business-actions">
                    <button className="primary" disabled={busy || entry.pending <= 0} onClick={() => run(async () => `Collected ${naira((await api.collectBusiness(entry.id)).collected)} from ${entry.name}.`)}>
                      Collect {naira(entry.pending)}{entry.full ? " · full" : ""}
                    </button>
                    {entry.upgradeCost !== null ? (
                      <button disabled={busy} onClick={() => run(async () => (await api.upgradeBusiness(entry.id), `${entry.name} is now level ${entry.level + 1}.`))}>
                        Upgrade · {naira(entry.upgradeCost)}
                      </button>
                    ) : (
                      <small className="muted">Top level</small>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === "start" && (
        <ul className="business-list">
          {businessTypeIds.map((type) => {
            const spec = BUSINESS_TYPES[type];
            const locked = spec.needs !== null && !certified.has(spec.needs);
            return (
              <li key={type} className={`business-card ${locked ? "locked" : ""}`}>
                <div className="business-head">
                  <span className="business-emoji">{spec.emoji}</span>
                  <div>
                    <strong>{spec.name}</strong>
                    <small className="muted">{spec.blurb}</small>
                    <small>Start-up {naira(spec.cost)} · earns {naira(spec.perHour)}/h at level 1</small>
                    {spec.needs && <small className={locked ? "warn" : "ok"}>{locked ? "🔒" : "✓"} Needs {COURSES[spec.needs].name}</small>}
                  </div>
                </div>
                {owned.has(type) ? (
                  <small className="muted">You run one</small>
                ) : naming === type ? (
                  <div className="business-actions">
                    <input value={name} maxLength={40} placeholder="Business name" onChange={(event) => setName(event.target.value)} />
                    <button
                      className="primary"
                      disabled={busy || name.trim().length < 2}
                      onClick={() => run(async () => {
                        await api.startBusiness(type, name.trim());
                        setNaming(null);
                        setName("");
                        setTab("mine");
                        return `${name.trim()} is open for business!`;
                      })}
                    >
                      Register
                    </button>
                  </div>
                ) : (
                  <button disabled={busy} onClick={() => (locked ? setTab("school") : (setNaming(type), setName("")))}>{locked ? "Go to school" : "Start"}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "school" && (
        <>
          <p className="muted small">Lagos Skills Academy (fictional). One course at a time; each takes a few minutes and gives a certificate for good.</p>
          {studying && (
            <p className="travel-flag">📖 Studying {COURSES[studying.course].name} · certificate in {Math.max(1, Math.ceil((new Date(studying.endsAt).getTime() - now) / 1000))} s</p>
          )}
          <ul className="business-list">
            {courseIds.map((course) => {
              const spec = COURSES[course];
              const done = certified.has(course);
              const current = studying?.course === course;
              return (
                <li key={course} className="business-card">
                  <div className="business-head">
                    <span className="business-emoji">{spec.emoji}</span>
                    <div>
                      <strong>{spec.name}</strong>
                      <small className="muted">{spec.perk}</small>
                      <small>{naira(spec.fee)} · {spec.minutes} min</small>
                    </div>
                  </div>
                  {done ? (
                    <small className="ok">🎓 Certified</small>
                  ) : current ? (
                    <small className="muted">In class…</small>
                  ) : (
                    <button disabled={busy || Boolean(studying)} onClick={() => run(async () => (await api.enrol(course), `Enrolled in ${spec.name}. Your certificate is ready in ${spec.minutes} minutes.`))}>
                      Enrol
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="muted small">Game roleplay with fictional game naira. Businesses are not real investments.</p>
    </div>
  );
}
