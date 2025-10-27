# OpenStay — Timelock Escrow on Solana (Anchor + React)

OpenStay is a demo dApp that lets **guests** lock an SPL token (e.g. USDC) in a **time-locked escrow** when booking and **release** it to the **host** after checkout.

- **Program:** Anchor smart contract (`timelock_escrow`)
- **Frontend:** React + TypeScript + Vite (Phantom-only; no backend required)
- **Network:** Devnet by default (Localnet optional)

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Repository Layout](#repository-layout)
- [Quick Start (Devnet)](#quick-start-devnet)
  - [1) Deploy the Anchor program](#1-deploy-the-anchor-program)
  - [2) Fund and mint test tokens](#2-fund-and-mint-test-tokens)
  - [3) Configure the frontend](#3-configure-the-frontend)
  - [4) Run the frontend](#4-run-the-frontend)
- [How It Works](#how-it-works)
- [Program Details](#program-details)
- [Frontend Details](#frontend-details)
- [Localnet (Optional)](#localnet-optional)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [License](#license)

---

## Architecture

**Escrow model**

- Escrow PDA seeds:  
  `["escrow", initializer, beneficiary, mint, i64_le(releaseTs)]`
- **Vault ATA** (owned by the escrow PDA) holds the locked funds.
- **initialize**: transfers `amount` from guest ATA → vault ATA.
- **release**: after `releaseTs`, transfers vault ATA → host ATA.

**No backend required**

- Frontend constructs Anchor-layout instructions directly:
  - 8-byte discriminator = `sha256("global:<name>")[:8]`
  - Little-endian integers for args
- Phantom signs & sends.

---

## Prerequisites

- **Node.js** 18+ or 20+
- **Rust** + **Anchor CLI**
- **Solana CLI** + **SPL Token CLI**
- **Phantom** wallet extension

---

## Repository Layout

\`\`\`
openstay/
  anchor/                        # Anchor program
    programs/timelock-escrow/
      src/lib.rs
    Anchor.toml
    Cargo.toml
  frontend/                     # React + Vite app
    src/
      lib/escrowClient.ts
      pages/
        Landing.tsx
        Listings.tsx
        ListingDetail.tsx
        Checkout.tsx
        Dashboard.tsx
      App.tsx
      index.css
      polyfills.ts
      main.tsx
    .env.example
    vite.config.ts
    package.json
\`\`\`

---

## Quick Start (Devnet)

### 1) Deploy the Anchor program

From \`anchor/\`:

\`\`\`bash
# Point Solana CLI to devnet (once)
solana config set --url https://api.devnet.solana.com

# Make sure your deployer keypair has SOL
solana airdrop 2 || true

# Build and deploy the program
anchor build
anchor deploy
\`\`\`

You should see:
\`\`\`
Program Id: <YOUR_PROGRAM_ID>
Idl account created: <IDL_PDA>
Deploy success
\`\`\`

Copy **YOUR_PROGRAM_ID** — needed in the frontend \`.env\`.

Verify:
\`\`\`bash
solana program show <YOUR_PROGRAM_ID>
anchor idl fetch --provider.cluster devnet <YOUR_PROGRAM_ID>
\`\`\`

---

### 2) Fund and mint test tokens

You need a **devnet SPL mint** (test USDC) and funds for your **guest** account.

Set variables:

\`\`\`bash
URL=https://api.devnet.solana.com
GUEST=<GUEST_PUBLIC_KEY>         # your Phantom address for booking
MINT=<YOUR_DEVNET_TEST_MINT>     # an SPL mint you control on devnet
\`\`\`

Create the guest’s ATA (if missing):

\`\`\`bash
# Prints the ATA on the last line
spl-token address --verbose --token $MINT --owner $GUEST --url $URL

# Create ATA (payer = your local CLI keypair)
spl-token create-account $MINT --owner $GUEST --url $URL
\`\`\`

Mint tokens to the guest (requires mint authority):

\`\`\`bash
# Example: mint 200 (for 6 decimals = 200.000000)
spl-token mint $MINT 200 --recipient-owner $GUEST --url $URL

# Check token balances
spl-token accounts --owner $GUEST --url $URL
\`\`\`

Give the guest some SOL for fees:

\`\`\`bash
solana airdrop 1 $GUEST --url $URL || true
\`\`\`

> If you don’t have a mint yet, create one with \`spl-token create-token --decimals 6\` (you will be the mint authority), then repeat the steps above.

---

### 3) Configure the frontend

From \`frontend/\`:

\`\`\`bash
cp .env.example .env
\`\`\`

Edit \`.env\`:

\`\`\`dotenv
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_PROGRAM_ID=<YOUR_PROGRAM_ID>      # from 'anchor deploy'
VITE_USDC_MINT=<YOUR_DEVNET_TEST_MINT> # same as $MINT above
VITE_USDC_DECIMALS=6
\`\`\`

Install deps + **Buffer polyfill** (required by SPL in browser):

\`\`\`bash
npm install
npm i buffer
\`\`\`

Create \`src/polyfills.ts\` (must exist and load first):

\`\`\`ts
// src/polyfills.ts
import { Buffer } from "buffer";

declare global {
  interface Window { Buffer: typeof Buffer }
}

if (!(window as any).Buffer) {
  (window as any).Buffer = Buffer;
}
\`\`\`

Ensure it’s the **first import** in \`src/main.tsx\`:

\`\`\`ts
// src/main.tsx
import "./polyfills"; // must be first, before any Solana/SPL imports

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
\`\`\`

---

### 4) Run the frontend

\`\`\`bash
npm run dev
\`\`\`

Open the printed URL (e.g. \`http://localhost:5173\`), connect **Phantom**, and try a booking.

---

## How It Works

1. **Listings → Checkout**  
   Select dates; UI calculates **nights**, **amount**, and \`releaseTs\` (checkout time).

2. **Hold (initialize)**  
   Frontend:
   - Verifies guest’s **ATA** exists & has enough balance.
   - Idempotently creates the **vault ATA** (owned by the escrow PDA).
   - Builds Anchor-layout instruction:
     \`\`\`
     data = sha256("global:initialize")[:8]
            + amount (u64 LE)
            + releaseTs (i64 LE)
     \`\`\`
   - Phantom signs & sends.

3. **Release**  
   After \`releaseTs\`, guest (or host) clicks **Release**, sending:
   \`\`\`
   data = sha256("global:release")[:8]
   \`\`\`
   Program transfers funds from **vault ATA** → **beneficiary ATA**.

4. **Dashboard**  
   Shows local “bookings” (from \`localStorage\`). After a successful release, the
   item is marked **Released** and disabled.

---

## Program Details

**PDA seeds**
\`\`\`
["escrow", initializer, beneficiary, mint, i64_le(releaseTs)]
\`\`\`

**Initialize accounts**
1. \`initializer\` (signer, writable)
2. \`beneficiary\`
3. \`mint\`
4. \`escrow\` (PDA, writable)
5. \`initializerAta\` (writable)
6. \`vaultAta\` (writable; ATA owned by PDA)
7. \`tokenProgram\`
8. \`associatedTokenProgram\`
9. \`systemProgram\`

**Release accounts**
1. \`payer\` (signer; any user paying fees)
2. \`beneficiary\`
3. \`mint\`
4. \`escrow\` (PDA, writable)
5. \`vaultAta\` (writable)
6. \`beneficiaryAta\` (writable)
7. \`tokenProgram\`
8. \`associatedTokenProgram\`
9. \`systemProgram\`

**Guards**
- \`release\` requires on-chain \`Clock::get()?.unix_timestamp >= releaseTs\`.

---

## Frontend Details

Key file: \`frontend/src/lib/escrowClient.ts\`

- Creates instructions by computing 8-byte discriminators:
  - \`sha256("global:<name>")[:8]\`
- Uses **little-endian** integers for args.
- Idempotently creates **vault ATA** with \`createAssociatedTokenAccountIdempotentInstruction\`.
- Confirms transactions via \`connection.confirmTransaction(signature, "confirmed")\`.
- Stores lightweight booking records in \`localStorage\` (for demo).

Pages:
- \`Landing.tsx\` — marketing hero → CTA to listings
- \`Listings.tsx\`, \`ListingDetail.tsx\` — browse dummy stays
- \`Checkout.tsx\` — builds/executes \`initialize\`
- \`Dashboard.tsx\` — lists bookings, allows \`release\`

---

## Localnet (Optional)

Run a local validator:

\`\`\`bash
solana-test-validator --reset
\`\`\`

In \`anchor/Anchor.toml\`:

\`\`\`toml
[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"
\`\`\`

Build & deploy:

\`\`\`bash
anchor build
anchor deploy --provider.cluster localnet
\`\`\`

Point the frontend \`.env\` at your local RPC and program id.

---

## Troubleshooting

**\`DeclaredProgramIdMismatch (0x1004)\` while creating IDL**  
\`declare_id!\` in \`lib.rs\` doesn’t match the deployed id. Fix it, rebuild, redeploy.

**\`Buffer is not defined\` in browser**  
Missing polyfill. Ensure \`buffer\` is installed and \`src/polyfills.ts\` is imported **first** in \`main.tsx\`.

**“Unexpected error” in Phantom when holding funds**  
Initializer’s ATA missing or insufficient balance. Create the ATA and mint tokens to it.

**\`TimelockNotReached\` on release**  
On-chain time < \`releaseTs\`. Wait until the time passes (set a near-future time for testing).

**White screen**  
Open DevTools → Console. Usual causes: missing \`.env\`, wrong program id/mint, missing polyfill.

---

## Security Notes

This is a **demo**:
- No backend risk-controls, indexer, or monitoring.
- Never store private keys or secrets client-side.
- For production, consider a backend for indexing, notifications, compliance, and policy.

---

