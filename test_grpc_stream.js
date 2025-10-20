import Client from "@triton-one/yellowstone-grpc";
import { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT;
const GRPCTOKEN = process.env.GRPCTOKEN;
const COPY_WALLET = process.env.COPY_WALLET;

console.log(chalk.cyan("🔍 Testing gRPC Transaction Stream..."));
console.log(chalk.gray(`Endpoint: ${GRPC_ENDPOINT}`));
console.log(chalk.gray(`Token: ${GRPCTOKEN.slice(0, 8)}...`));
console.log(chalk.gray(`Monitoring wallet: ${COPY_WALLET}\n`));

async function testStream() {
  try {
    console.log(chalk.cyan("📡 Creating gRPC client..."));
    const client = new Client(GRPC_ENDPOINT, GRPCTOKEN);
    
    console.log(chalk.green("✅ Client created"));
    console.log(chalk.cyan("📡 Starting subscription..."));
    
    const stream = await client.subscribe();
    
    console.log(chalk.green("✅ Stream created"));
    console.log(chalk.cyan("📝 Setting up subscription request...\n"));
    
    // Subscription arguments - Monitor ALL transactions for this wallet
    const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
    
    const args = {
      accounts: {},
      slots: {},
      transactions: {
        allTxns: {
          vote: false,
          failed: false,
          signature: undefined,
          accountInclude: [COPY_WALLET], // Monitor wallet directly
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.PROCESSED,
    };
    
    console.log(chalk.yellow("⚙️ Subscription config:"));
    console.log(chalk.gray(JSON.stringify(args.transactions, null, 2)));
    console.log(chalk.cyan("\n🎯 This will show ALL transactions, not just Pump.fun"));
    console.log();
    
    // Setup data handler
    let transactionCount = 0;
    const startTime = Date.now();
    
    stream.on("data", (data) => {
      transactionCount++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      console.log(chalk.green(`\n✅ [${elapsed}s] Transaction #${transactionCount} received!`));
      console.log(chalk.cyan("📦 Data structure keys:"), Object.keys(data));
      
      if (data.transaction?.transaction) {
        console.log(chalk.green("✓ Has transaction data"));
        
        // Try to extract signature
        try {
          const signatures = data.transaction.transaction.transaction?.signatures;
          if (signatures && signatures.length > 0) {
            const sig = Buffer.from(signatures[0]).toString('base64').slice(0, 20);
            console.log(chalk.cyan(`📝 Signature: ${sig}...`));
          }
        } catch (e) {
          console.log(chalk.yellow("⚠️ Could not extract signature"));
        }
        
        console.log(chalk.gray(JSON.stringify(data.transaction, null, 2).slice(0, 500)));
      } else {
        console.log(chalk.yellow("⚠️ No transaction data in message"));
        console.log(chalk.gray(JSON.stringify(data, null, 2).slice(0, 300)));
      }
    });
    
    stream.on("error", (error) => {
      console.error(chalk.red("\n❌ Stream error:"), error.message);
      console.error(chalk.gray("Details:"), error);
    });
    
    stream.on("end", () => {
      console.log(chalk.yellow("\n⚠️ Stream ended"));
    });
    
    stream.on("close", () => {
      console.log(chalk.yellow("\n⚠️ Stream closed"));
    });
    
    // Write subscription request
    console.log(chalk.cyan("📤 Sending subscription request..."));
    await new Promise((resolve, reject) => {
      stream.write(args, (err) => {
        if (err) {
          console.error(chalk.red("❌ Failed to write subscription:"), err);
          reject(err);
        } else {
          console.log(chalk.green("✅ Subscription request sent successfully!"));
          resolve();
        }
      });
    });
    
    console.log(chalk.cyan(`\n⏳ Listening for transactions from ${COPY_WALLET}...`));
    console.log(chalk.gray("Waiting for activity... (Press Ctrl+C to stop)"));
    console.log(chalk.gray("Note: This may take a while if wallet isn't actively trading"));
    
    // Keep script running
    let lastUpdate = Date.now();
    setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      
      if (Date.now() - lastUpdate >= 10000) {
        console.log(chalk.gray(`\n⏱️  Still listening... ${minutes}m ${seconds}s | Transactions received: ${transactionCount}`));
        lastUpdate = Date.now();
      }
    }, 10000);
    
    // Add ping to keep connection alive
    setInterval(() => {
      const pingRequest = {
        accounts: {},
        slots: {},
        transactions: {},
        transactionsStatus: {},
        entry: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
        ping: { id: 1 },
      };
      
      stream.write(pingRequest, (err) => {
        if (err) {
          console.error(chalk.red("❌ Ping failed:"), err.message);
        }
      });
    }, 5000);
    
  } catch (error) {
    console.error(chalk.red("\n❌ Test failed:"), error.message);
    console.error(chalk.gray("Full error:"), error);
    
    if (error.code === 16) {
      console.log(chalk.yellow("\n💡 Authentication error - check your GRPCTOKEN"));
    } else if (error.code === 14) {
      console.log(chalk.yellow("\n💡 Connection error - check your GRPC_ENDPOINT"));
    }
    
    process.exit(1);
  }
}

console.log(chalk.yellow("━".repeat(60)));
console.log(chalk.yellow("This test will monitor the wallet for incoming transactions."));
console.log(chalk.yellow("If you don't see any transactions after a few minutes,"));
console.log(chalk.yellow("it means the wallet is not currently trading."));
console.log(chalk.yellow("━".repeat(60)));
console.log();

testStream();
