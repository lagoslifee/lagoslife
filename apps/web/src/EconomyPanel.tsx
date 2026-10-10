import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "./auth-client";

type EconomyState = {
  balance: number;
  catalog: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    price: number;
  }>;
  inventory: Array<{ itemId: string; name: string; quantity: number }>;
  transactions: Array<{
    id: string;
    kind: string;
    amount: number;
    balanceAfter: number;
    reference: string;
    createdAt: string;
  }>;
  activeJob: null | {
    id: string;
    reward: number;
    destinationX: number;
    destinationZ: number;
  };
};

const money = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

export function EconomyPanel() {
  const [state, setState] = useState<EconomyState | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/economy`, { credentials: "include" });
    if (response.ok) setState((await response.json()) as EconomyState);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(path: string, body?: object) {
    setBusy(path);
    setMessage("");
    const options: RequestInit = {
      method: "POST",
      credentials: "include",
    };
    if (body) {
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${apiUrl}${path}`, options);
    const result = (await response.json()) as { error?: string };
    setBusy("");
    if (!response.ok) {
      setMessage(result.error ?? "Action failed");
      return;
    }
    await load();
  }

  return (
    <>
      <button className="wallet-pill" onClick={() => setOpen(true)}>
        <span>GAME NAIRA</span>
        <strong>{state ? money.format(state.balance) : "…"}</strong>
      </button>
      {state?.activeJob && (
        <button className="job-pill" onClick={() => setOpen(true)}>
          <span>ACTIVE DELIVERY</span>
          <strong>
            Marker {state.activeJob.destinationX.toFixed(1)},{" "}
            {state.activeJob.destinationZ.toFixed(1)}
          </strong>
        </button>
      )}
      {open && (
        <div className="economy-backdrop" onMouseDown={() => setOpen(false)}>
          <section
            className="economy-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Wallet, shop, jobs, and inventory"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="step-label">CITY WALLET</p>
                <h2>{state ? money.format(state.balance) : "Loading…"}</h2>
                <small>Fictional game naira · no cash value</small>
              </div>
              <button aria-label="Close wallet" onClick={() => setOpen(false)}>×</button>
            </header>
            {message && <p className="economy-message" role="status">{message}</p>}

            <div className="economy-section">
              <h3>Neighbourhood delivery</h3>
              {state?.activeJob ? (
                <div className="active-job">
                  <div>
                    <strong>Deliver to the gold marker</strong>
                    <p>
                      Destination {state.activeJob.destinationX.toFixed(1)},{" "}
                      {state.activeJob.destinationZ.toFixed(1)} · Reward{" "}
                      {money.format(state.activeJob.reward)}
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      action("/api/jobs/delivery/complete", { jobId: state.activeJob!.id })
                    }
                  >
                    Verify delivery
                  </button>
                </div>
              ) : (
                <div className="active-job">
                  <div>
                    <strong>Alfred Rewane parcel run</strong>
                    <p>Start at the spawn marker and deliver through mapped Ikoyi.</p>
                  </div>
                  <button
                    className="primary"
                    disabled={Boolean(busy)}
                    onClick={() => action("/api/jobs/delivery/start")}
                  >
                    Start job
                  </button>
                </div>
              )}
            </div>

            <div className="economy-section">
              <h3>Falomo Corner Shop</h3>
              <div className="catalogue-grid">
                {state?.catalog.map((item) => (
                  <article key={item.id}>
                    <span>{item.category}</span>
                    <h4>{item.name}</h4>
                    <p>{item.description}</p>
                    <button
                      className="secondary"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        action("/api/shop/purchase", {
                          itemId: item.id,
                          idempotencyKey: crypto.randomUUID(),
                        })
                      }
                    >
                      Buy · {money.format(item.price)}
                    </button>
                  </article>
                ))}
              </div>
            </div>

            <div className="economy-columns">
              <div className="economy-section">
                <h3>Inventory</h3>
                {state?.inventory.length ? (
                  state.inventory.map((item) => (
                    <p className="ledger-row" key={item.itemId}>
                      <span>{item.name}</span><strong>×{item.quantity}</strong>
                    </p>
                  ))
                ) : <p className="empty-copy">Nothing carried yet.</p>}
              </div>
              <div className="economy-section">
                <h3>Recent transactions</h3>
                {state?.transactions.slice(0, 6).map((transaction) => (
                  <p className="ledger-row" key={transaction.id}>
                    <span>{transaction.reference}</span>
                    <strong className={transaction.amount >= 0 ? "credit" : "debit"}>
                      {transaction.amount >= 0 ? "+" : ""}
                      {money.format(transaction.amount)}
                    </strong>
                  </p>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
