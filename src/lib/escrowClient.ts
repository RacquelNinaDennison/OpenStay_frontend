// src/lib/escrowClient.ts
import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount as getSplAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

// ---------- ENV ----------
type EscrowConfig = {
  RPC: string;
  PROGRAM_ID: PublicKey;
  USDC_MINT: PublicKey;
  USDC_DECIMALS: number;
};

function getConfig(): EscrowConfig {
  const RPC = import.meta.env.VITE_SOLANA_RPC as string | undefined;
  const PROGRAM = import.meta.env.VITE_PROGRAM_ID as string | undefined;
  const MINT = import.meta.env.VITE_USDC_MINT as string | undefined;
  const DEC = Number(import.meta.env.VITE_USDC_DECIMALS ?? 6);

  if (!RPC)     throw new Error("Missing VITE_SOLANA_RPC in your front-end env.");
  if (!PROGRAM) throw new Error("Missing VITE_PROGRAM_ID in your front-end env.");
  if (!MINT)    throw new Error("Missing VITE_USDC_MINT in your front-end env.");

  return {
    RPC,
    PROGRAM_ID: new PublicKey(PROGRAM),
    USDC_MINT: new PublicKey(MINT),
    USDC_DECIMALS: DEC,
  };
}

// Exported connection (object, not a function)
const { RPC } = getConfig();
const ws = RPC.startsWith("https://")
  ? RPC.replace("https://", "wss://")
  : RPC.replace("http://", "ws://");

export const connection = new Connection(RPC, {
  commitment: "confirmed",
  wsEndpoint: ws,
});

// ---------- Wallet ----------
export type SolanaProvider = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string };
  connect: (opts?: any) => Promise<{ publicKey: { toBase58(): string } }>;
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  on?: (event: string, cb: (...args: any[]) => void) => void;
  removeAllListeners?: () => void;
};

export const phantom = (): SolanaProvider | null => {
  const w = window as any;
  return w?.solana ?? w?.phantom?.solana ?? null;
};

// ---------- Bytes helpers ----------
function i64LeBytes(n: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigInt64(0, BigInt(n), true);
  return new Uint8Array(buf);
}
function u64LeBytes(n: string | number | bigint): Uint8Array {
  const v = typeof n === "bigint" ? n : BigInt(n);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, v, true);
  return new Uint8Array(buf);
}
function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ---------- Discriminators (your hard-coded values) ----------
const DISC_INIT    = new Uint8Array([0xaf,0xaf,0x6d,0x1f,0x0d,0x98,0x9b,0xed]);
const DISC_RELEASE = new Uint8Array([0xfd,0xf9,0x0f,0xce,0x1c,0x7f,0xc1,0xf1]);

// ---------- Program IDs ----------
const TOKEN_PROGRAM_ID      = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// ---------- PDA + ATAs ----------
export function escrowPda(
  initializer: PublicKey,
  beneficiary: PublicKey,
  mint: PublicKey,
  releaseTs: number
): [PublicKey, number] {
  const { PROGRAM_ID } = getConfig();
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      initializer.toBuffer(),
      beneficiary.toBuffer(),
      mint.toBuffer(),
      Buffer.from(i64LeBytes(releaseTs)),
    ],
    PROGRAM_ID
  );
}

export const ata = (owner: PublicKey, mint: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, false);
export const vaultAta = (pda: PublicKey, mint: PublicKey) =>
  getAssociatedTokenAddressSync(mint, pda, true);

// ---------- Instruction builders ----------
function ixInitialize(params: {
  initializer: PublicKey;
  beneficiary: PublicKey;
  mint: PublicKey;
  escrow: PublicKey;
  initializerAta: PublicKey;
  vaultAta: PublicKey;
  amount: string | number | bigint;
  releaseTs: number;
}): TransactionInstruction {
  const { PROGRAM_ID } = getConfig();
  const keys = [
    { pubkey: params.initializer,    isSigner: true,  isWritable: true },
    { pubkey: params.beneficiary,    isSigner: false, isWritable: false },
    { pubkey: params.mint,           isSigner: false, isWritable: false },
    { pubkey: params.escrow,         isSigner: false, isWritable: true  },
    { pubkey: params.initializerAta, isSigner: false, isWritable: true  },
    { pubkey: params.vaultAta,       isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,      isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Web3 expects Buffer; convert from Uint8Array
  const dataU8 = concatBytes(DISC_INIT, u64LeBytes(params.amount), i64LeBytes(params.releaseTs));
  const data   = Buffer.from(dataU8);

  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

function ixRelease(params: {
  payer: PublicKey;
  beneficiary: PublicKey;
  mint: PublicKey;
  escrow: PublicKey;
  vaultAta: PublicKey;
  beneficiaryAta: PublicKey;
}): TransactionInstruction {
  const { PROGRAM_ID } = getConfig();
  const keys = [
    { pubkey: params.payer,          isSigner: true,  isWritable: true  },
    { pubkey: params.beneficiary,    isSigner: false, isWritable: false },
    { pubkey: params.mint,           isSigner: false, isWritable: false },
    { pubkey: params.escrow,         isSigner: false, isWritable: true  },
    { pubkey: params.vaultAta,       isSigner: false, isWritable: true  },
    { pubkey: params.beneficiaryAta, isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,      isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  // Convert to Buffer
  const data = Buffer.from(DISC_RELEASE);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

// ---------- Public helpers ----------
export function uiToBase(ui: string, decimals = getConfig().USDC_DECIMALS): string {
  const [i, f = ""] = ui.trim().split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(i || "0") * BigInt(10 ** decimals) + BigInt(frac || "0")).toString();
}
export function toDateLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function localToUnix(s: string) {
  return Math.floor(new Date(s).getTime() / 1000);
}

// ---------- Hold / Release ----------
export async function holdWithWallet(args: {
  wallet: SolanaProvider;
  initializer: string;
  beneficiary: string;
  amountBase: string;   // base units
  releaseTs: number;
}): Promise<string> {
  const { USDC_MINT } = getConfig();

  const initializerPk = new PublicKey(args.initializer);
  const beneficiaryPk = new PublicKey(args.beneficiary);

  const [escrow]      = escrowPda(initializerPk, beneficiaryPk, USDC_MINT, args.releaseTs);
  const initializerTa = ata(initializerPk, USDC_MINT);
  const vault         = vaultAta(escrow, USDC_MINT);

  // Ensure initializer ATA exists & has funds
  try {
    const acc = await getSplAccount(connection, initializerTa);
    const have = BigInt(acc.amount.toString());
    const need = BigInt(args.amountBase);
    if (have < need) throw new Error(`Insufficient USDC: have ${have}, need ${need}`);
  } catch {
    throw new Error(`Initializer ATA missing or unfunded: ${initializerTa.toBase58()}`);
  }

  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      initializerPk, // payer
      vault,
      escrow,
      USDC_MINT
    ),
    ixInitialize({
      initializer: initializerPk,
      beneficiary: beneficiaryPk,
      mint: USDC_MINT,
      escrow,
      initializerAta: initializerTa,
      vaultAta: vault,
      amount: args.amountBase,
      releaseTs: args.releaseTs,
    }),
  ];

  const tx = new Transaction().add(...ixs);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = initializerPk;

  if (args.wallet.signAndSendTransaction) {
    const { signature } = await args.wallet.signAndSendTransaction(tx);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  } else if (args.wallet.signTransaction) {
    const signed = await args.wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }
  throw new Error("Wallet cannot sign transactions");
}

export async function releaseWithWallet(args: {
  wallet: SolanaProvider;
  initializer: string;
  beneficiary: string;
  releaseTs: number;
}): Promise<string> {
  const { USDC_MINT } = getConfig();

  if (!args.wallet.publicKey) await args.wallet.connect();
  const payerPk       = new PublicKey(args.wallet.publicKey!.toBase58());
  const initializerPk = new PublicKey(args.initializer);
  const beneficiaryPk = new PublicKey(args.beneficiary);

  const [escrow]      = escrowPda(initializerPk, beneficiaryPk, USDC_MINT, args.releaseTs);
  const vault         = vaultAta(escrow, USDC_MINT);
  const beneficiaryTa = ata(beneficiaryPk, USDC_MINT);

  const tx = new Transaction().add(
    ixRelease({
      payer: payerPk,
      beneficiary: beneficiaryPk,
      mint: USDC_MINT,
      escrow,
      vaultAta: vault,
      beneficiaryAta: beneficiaryTa,
    })
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("processed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerPk;

  if (args.wallet.signAndSendTransaction) {
    const { signature } = await args.wallet.signAndSendTransaction(tx);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  } else if (args.wallet.signTransaction) {
    const signed = await args.wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }
  throw new Error("Wallet cannot sign transactions");
}
