# OpenStay Frontend (React + TypeScript + Vite)

A demo frontend for **time-locked USDC escrow on Solana**. Guests browse listings, lock funds in escrow until checkout, and later release funds to hosts — **entirely in the browser using Phantom**, no server required.

## Features

- Landing → Listings → Listing Detail → Checkout → Dashboard
- “Hold” USDC in escrow (`initialize`)
- “Release” to the host after the timelock (`release`)
- Devnet-ready, clean UI, TypeScript
- Client builds Anchor-layout instructions (no IDL needed at runtime)

---

## Prerequisites

- Node.js 18+ (or 20+)
- Phantom wallet extension
- (Optional) Solana CLI + SPL Token CLI for minting test tokens on devnet

---

## Quick Start

```bash
# 1) Install deps
npm install

# 2) Configure environment
cp .env.example .env    # or create .env per snippet below

# 3) Start
npm run dev
