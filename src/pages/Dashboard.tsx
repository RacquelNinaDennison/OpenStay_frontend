// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { phantom, releaseWithWallet } from "../lib/escrowClient";

type Booking = {
  id: string;
  listingId: string;
  initializer: string;
  beneficiary: string;
  totalUi: string;
  releaseTs: number;
  released?: boolean;
};

function readBookings(): Booking[] {
  try {
    const raw = localStorage.getItem("bookings");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x === "object" && x.id && x.initializer);
  } catch {
    return [];
  }
}

export default function Dashboard({ wallet }: { wallet: string | null }) {
  const [items, setItems] = useState<Booking[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => { setItems(readBookings()); }, [wallet]);

  const myItems = useMemo(
    () => (wallet ? items.filter((x) => x.initializer === wallet) : []),
    [items, wallet]
  );

  function markReleased(id: string) {
    const next = items.map(b => b.id === id ? { ...b, released: true } : b);
    setItems(next);
    localStorage.setItem("bookings", JSON.stringify(next));
  }

  async function handleRelease(rec: Booking) {
    setErr("");
    setBusyId(rec.id);
    try {
      const p = phantom();
      if (!p?.isPhantom) throw new Error("Phantom not detected");
      if (!p.publicKey) await p.connect();

      const canRelease = Math.floor(Date.now()/1000) >= (rec.releaseTs || 0);
      if (!canRelease) throw new Error("Release time not reached yet");

      const sig = await releaseWithWallet({
        wallet: p,
        initializer: rec.initializer,
        beneficiary: rec.beneficiary,
        releaseTs: rec.releaseTs,
      });

      markReleased(rec.id);
      alert(`Released! ${sig.slice(0, 8)}…`);
    } catch (e: any) {
      setErr(e?.message || "Release failed. See console.");
      console.error("[Dashboard release error]", e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card main-card" style={{ padding: 24 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 className="h2" style={{ margin: 0 }}>Your Escrows</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            Manage holds you’ve created while booking.
          </div>
        </div>
      </div>

      {err && (
        <div className="status err" style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10 }}>
          {err}
        </div>
      )}

      {!wallet && (
        <div className="card" style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "#fafafa" }}>
          <div className="muted">Connect your wallet to view your escrows.</div>
        </div>
      )}

      {wallet && myItems.length === 0 && (
        <div className="card" style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "#fafafa" }}>
          <div className="muted">No active escrows yet.</div>
        </div>
      )}

      {wallet && myItems.length > 0 && (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {myItems.map((r) => {
            const canRelease = Date.now()/1000 >= (r.releaseTs || 0);
            const released = !!r.released;
            return (
              <div key={r.id} className="card" style={{ padding: 16, borderRadius: 12, boxShadow: "0 1px 3px rgba(16,24,40,0.08)" }}>
                <div className="row" style={{ alignItems: "center", gap: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{r.listingId}</div>
                    <div className="muted" style={{ marginTop: 4 }}>Total: ${r.totalUi} USDC</div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      Releases: {r.releaseTs ? new Date(r.releaseTs * 1000).toLocaleString() : "—"}
                    </div>
                    {released && <div className="ok" style={{ marginTop: 6 }}>Released ✅</div>}
                  </div>

                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="btn btn-accent"
                      onClick={() => handleRelease(r)}
                      disabled={busyId === r.id || !canRelease || released}
                      title={!canRelease ? "Release time not reached yet" : released ? "Already released" : ""}
                      style={{ minWidth: 140 }}
                    >
                      {busyId === r.id ? "Releasing…" : released ? "Released" : "Release"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
