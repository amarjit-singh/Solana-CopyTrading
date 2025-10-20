import { pump_geyser, testLocalTransaction } from "./main.js";

const encodedPrivateKey = process.env.ENCODED_PRIVATE_KEY; // or load from file
if (!encodedPrivateKey) {
  console.error("Error: ENCODED_PRIVATE_KEY is not set in environment variables.");
  process.exit(1);
}


export const decodedPrivateKey = encodedPrivateKey

// Check if running in test mode
const testMode = process.env.TEST_MODE === "true" || process.argv.includes("--test");

if (testMode) {
  console.log("🧪 Running in TEST MODE - simulating local transactions");
  testLocalTransaction().catch(error => {
    console.error("Test failed:", error);
    process.exit(1);
  });
} else {
  console.log("🚀 Running in PRODUCTION MODE - monitoring live transactions");
  pump_geyser();
}

