// src/pages/Checkout.tsx
import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  phantom,
  holdWithWallet,
  uiToBase,
  localToUnix,
  toDateLocalInput,
} from "../lib/escrowClient";
import { LISTINGS } from "../data/listings";
import { useNavigate, useParams } from "react-router-dom";

export default function Checkout({ wallet }: { wallet: string | null }) {
  const { id } = useParams();
  const nav = useNavigate();
  const l = LISTINGS.find((x) => x.id === id);

  const [checkIn, setCheckIn] = useState(toDateLocalInput(new Date()));
  const [checkOut, setCheckOut] = useState(
    toDateLocalInput(new Date(Date.now() + 24 * 3600 * 1000))
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = phantom();
    if (!p) return;
    const onConnect = (pk: any) =>
      console.log("[PHANTOM] connect", pk?.toBase58?.() ?? pk?.publicKey?.toBase58?.());
    p.on?.("connect", onConnect);
    return () => p.removeAllListeners?.();
  }, []);

  const nights = useMemo(() => {
    const a = new Date(checkIn).getTime();
    const b = new Date(checkOut).getTime();
    return Math.max(1, Math.ceil((b - a) / (24 * 3600 * 1000)));
  }, [checkIn, checkOut]);

  if (!l) return <div className="card">Listing not found</div>;

  const totalUi = (l.pricePerNight * nights).toFixed(2);

  function assertPk(label: string, v: string) {
    try { return new PublicKey(v); } catch { throw new Error(`${label} is not a valid address`); }
  }

  async function placeHold() {
    try {
      if (!wallet) { setStatus("Connect wallet first."); return; }
      setBusy(true);
      setStatus("Validating…");

      const initializerPk = assertPk("Initializer", wallet);
      const beneficiaryPk = assertPk("Beneficiary", l.hostAddress);
      const releaseTs = localToUnix(checkOut);
      if (releaseTs <= Math.floor(Date.now() / 1000)) {
        throw new Error("Release time must be in the future");
      }

      const amountBase = uiToBase(totalUi);

      const p = phantom();
      if (!p?.isPhantom) throw new Error("Phantom not detected");
      if (!p.publicKey) await p.connect();

      setStatus("Please approve in Phantom…");
      const sig = await holdWithWallet({
        wallet: p,
        initializer: initializerPk.toBase58(),
        beneficiary: beneficiaryPk.toBase58(),
        amountBase,
        releaseTs,
      });

      // Save a light record
      const rec = {
        id: `${l.id}-${releaseTs}`,
        listingId: l.id,
        initializer: wallet,
        beneficiary: l.hostAddress,
        totalUi,
        releaseTs,
      };
      const past = JSON.parse(localStorage.getItem("bookings") || "[]");
      localStorage.setItem("bookings", JSON.stringify([...past, rec]));

      setStatus(`Escrow created ✅ ${sig.slice(0, 8)}… Redirecting…`);
      nav("/dashboard");
    } catch (e: any) {
      setStatus(`Hold failed: ${e?.message || String(e)}`);
      console.error("[Checkout hold error]", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card main-card">
      <h2>Confirm your stay</h2>
      <div className="muted">{l.title} — {l.location}</div>

      <div className="row" style={{ gap: 16, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Check-in</label>
          <input className="input" type="datetime-local" value={checkIn}
                 onChange={(e) => setCheckIn(e.target.value)} disabled={busy}/>
        </div>
        <div style={{ flex: 1 }}>
          <label className="label">Check-out</label>
          <input className="input" type="datetime-local" value={checkOut}
                 onChange={(e) => setCheckOut(e.target.value)} disabled={busy}/>
        </div>
      </div>

      <div className="row space" style={{ marginTop: 12 }}>
        <div><strong>Nights:</strong> {nights}</div>
        <div><strong>Total:</strong> ${totalUi} USDC</div>
      </div>

      <button className="btn btn-primary" onClick={placeHold}
              style={{ marginTop: 16 }} disabled={busy}>
        {busy ? "Processing…" : `Hold $${totalUi} in Escrow`}
      </button>

      {status && (
        <div className={`status ${/failed|error/i.test(status) ? "err" : "ok"}`}
             style={{ marginTop: 12 }}>
          {status}
        </div>
      )}
    </div>
  );
}
