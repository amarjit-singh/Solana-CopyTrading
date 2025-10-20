import Client from "@triton-one/yellowstone-grpc";
import dotenv from "dotenv";

dotenv.config();

const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT;
const GRPCTOKEN = process.env.GRPCTOKEN;

console.log("🔍 Testing gRPC Token...");
console.log("Endpoint:", GRPC_ENDPOINT);
console.log("Token:", GRPCTOKEN ? `${GRPCTOKEN.slice(0, 4)}****${GRPCTOKEN.slice(-4)}` : "NOT SET");

async function testToken() {
  try {
    console.log("\n📡 Connecting to gRPC endpoint...");
    
    const client = new Client(
      GRPC_ENDPOINT,
      GRPCTOKEN,
      undefined
    );

    console.log("✅ Client created");
    
    // Try to subscribe with minimal filters
    console.log("\n🔄 Testing subscription...");
    const stream = await client.subscribe();
    
    console.log("✅ Subscription created successfully!");
    console.log("🎉 Your gRPC token is VALID and working!");
    
    // Close the stream
    stream.end();
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error("\n📋 Error Details:");
    console.error("Code:", error.code);
    console.error("Details:", error.details);
    
    console.log("\n🔍 Diagnosis:");
    if (error.details === "token not found") {
      console.log("❌ Your token is INVALID or EXPIRED");
      console.log("\n💡 Solutions:");
      console.log("1. Go to https://shyft.to/");
      console.log("2. Login and navigate to API Keys");
      console.log("3. Generate a new gRPC API key");
      console.log("4. Update GRPCTOKEN in .env file");
      console.log("\nOR");
      console.log("Switch to a different provider:");
      console.log("- Helius: https://helius.dev/");
      console.log("- Triton: https://triton.one/");
    } else if (error.code === 14) {
      console.log("🌐 Network connection issue");
      console.log("Check your internet connection and firewall");
    } else if (error.code === 8) {
      console.log("🚫 Rate limited or quota exceeded");
      console.log("Check your Shyft account limits");
    }
    
    process.exit(1);
  }
}

testToken();
