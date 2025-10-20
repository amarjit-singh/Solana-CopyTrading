import { Connection, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

const COPY_WALLET = process.env.COPY_WALLET;
const HELIUS_TOKEN = process.env.GRPCTOKEN;

console.log("\n�� Testing Helius WebSocket (Alternative to gRPC)...\n");
console.log(`Monitoring wallet: ${COPY_WALLET}`);
console.log(`Token: ${HELIUS_TOKEN.slice(0, 8)}...\n`);

// Helius doesn't use gRPC the same way - it uses enhanced WebSocket
const connection = new Connection(
  `https://mainnet.helius-rpc.com/?api-key=${HELIUS_TOKEN}`,
  {
    wsEndpoint: `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_TOKEN}`,
    commitment: 'confirmed'
  }
);

console.log("✅ Connection created");
console.log("📡 Setting up account change listener...\n");

const publicKey = new PublicKey(COPY_WALLET);

let transactionCount = 0;
const startTime = Date.now();

// Listen to account changes
const subscriptionId = connection.onAccountChange(
  publicKey,
  (accountInfo, context) => {
    transactionCount++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`\n✅ [${elapsed}s] Account change #${transactionCount} detected!`);
    console.log(`Slot: ${context.slot}`);
    console.log(`Lamports: ${accountInfo.lamports / 1e9} SOL`);
  },
  'confirmed'
);

console.log(`✅ Subscription ID: ${subscriptionId}`);
console.log("\n⏳ Listening for account changes...");
console.log("(Press Ctrl+C to stop)\n");

// Also try signature subscription
connection.onLogs(
  publicKey,
  (logs, context) => {
    console.log(`\n📝 Transaction logs received!`);
    console.log(`Signature: ${logs.signature}`);
    console.log(`Slot: ${context.slot}`);
    console.log(`Logs: ${logs.logs.slice(0, 3).join('\n')}`);
  },
  'confirmed'
);

console.log("✅ Also listening for transaction logs\n");

// Keep script running
setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`⏱️  Still listening... ${elapsed}s elapsed | Changes detected: ${transactionCount}`);
}, 30000);

