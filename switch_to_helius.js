#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

console.log('\n🚀 GRPC Token Setup Helper\n');
console.log('════════════════════════════════════════════════════════════════\n');
console.log('Your current Shyft token does NOT have gRPC access.');
console.log('This script will help you switch to a working gRPC provider.\n');
console.log('════════════════════════════════════════════════════════════════\n');

console.log('📋 Available Options:\n');
console.log('1️⃣  Helius (FREE) ⭐ RECOMMENDED');
console.log('   - Free tier: 250k requests/day');
console.log('   - gRPC included for free');
console.log('   - No credit card required');
console.log('   - Sign up: https://helius.dev/\n');

console.log('2️⃣  Shyft (Paid)');
console.log('   - Requires paid subscription (~$100+/month)');
console.log('   - gRPC access on paid plans only');
console.log('   - Dashboard: https://shyft.to/dashboard\n');

console.log('3️⃣  Triton One (Paid)');
console.log('   - High performance (~$50+/month)');
console.log('   - Sign up: https://triton.one/\n');

console.log('4️⃣  Keep current setup (troubleshoot later)\n');

async function main() {
  try {
    const choice = await question('Choose an option (1-4): ');

    switch (choice.trim()) {
      case '1':
        await setupHelius();
        break;
      case '2':
        await setupShyft();
        break;
      case '3':
        await setupTriton();
        break;
      case '4':
        console.log('\n✅ No changes made. Check HOW_TO_GET_GRPC_TOKEN.md for manual setup.');
        break;
      default:
        console.log('\n❌ Invalid choice. Exiting...');
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    rl.close();
  }
}

async function setupHelius() {
  console.log('\n🌟 Setting up Helius (FREE)\n');
  console.log('Steps:');
  console.log('1. Go to: https://helius.dev/');
  console.log('2. Sign up for FREE account (no credit card)');
  console.log('3. Go to Dashboard: https://dashboard.helius.dev/');
  console.log('4. Create new API key');
  console.log('5. Copy the API key\n');

  const hasKey = await question('Do you have your Helius API key ready? (yes/no): ');

  if (hasKey.toLowerCase() === 'yes' || hasKey.toLowerCase() === 'y') {
    const apiKey = await question('\nPaste your Helius API key here: ');

    if (!apiKey || apiKey.trim().length < 10) {
      console.log('\n❌ Invalid API key. Please try again.');
      rl.close();
      return;
    }

    await updateEnvFile('helius', apiKey.trim());
  } else {
    console.log('\n📝 Follow these steps:');
    console.log('1. Open: https://helius.dev/');
    console.log('2. Create free account');
    console.log('3. Get your API key');
    console.log('4. Run this script again\n');
  }
}

async function setupShyft() {
  console.log('\n🔧 Setting up Shyft gRPC\n');
  console.log('⚠️ Important: Shyft gRPC requires a PAID subscription!\n');
  console.log('Steps:');
  console.log('1. Go to: https://shyft.to/dashboard');
  console.log('2. Verify you have a PAID plan with gRPC access');
  console.log('3. Create a NEW API key (type: gRPC)');
  console.log('4. Copy the gRPC token\n');

  const hasKey = await question('Do you have your Shyft gRPC token ready? (yes/no): ');

  if (hasKey.toLowerCase() === 'yes' || hasKey.toLowerCase() === 'y') {
    const apiKey = await question('\nPaste your Shyft gRPC token here: ');

    if (!apiKey || apiKey.trim().length < 10) {
      console.log('\n❌ Invalid token. Please try again.');
      rl.close();
      return;
    }

    await updateEnvFile('shyft', apiKey.trim());
  } else {
    console.log('\n💡 Tip: If you don\'t have a paid Shyft plan, use Helius instead (option 1).\n');
  }
}

async function setupTriton() {
  console.log('\n⚡ Setting up Triton One\n');
  console.log('Steps:');
  console.log('1. Go to: https://triton.one/');
  console.log('2. Sign up for account');
  console.log('3. Get your API token from dashboard');
  console.log('4. Copy the token\n');

  const hasKey = await question('Do you have your Triton token ready? (yes/no): ');

  if (hasKey.toLowerCase() === 'yes' || hasKey.toLowerCase() === 'y') {
    const apiKey = await question('\nPaste your Triton token here: ');

    if (!apiKey || apiKey.trim().length < 10) {
      console.log('\n❌ Invalid token. Please try again.');
      rl.close();
      return;
    }

    await updateEnvFile('triton', apiKey.trim());
  } else {
    console.log('\n📝 Get your token from Triton dashboard and run this script again.\n');
  }
}

async function updateEnvFile(provider, apiKey) {
  const envPath = join(__dirname, '.env');

  try {
    // Read current .env file
    let envContent = fs.readFileSync(envPath, 'utf8');

    // Backup current .env
    const backupPath = join(__dirname, '.env.backup');
    fs.writeFileSync(backupPath, envContent);
    console.log(`\n✅ Backup created: .env.backup`);

    // Update based on provider
    let newGrpcToken, newGrpcEndpoint, newRpcUrl;

    switch (provider) {
      case 'helius':
        newGrpcToken = apiKey;
        newGrpcEndpoint = 'https://mainnet.helius-rpc.com';
        newRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
        break;
      case 'shyft':
        newGrpcToken = apiKey;
        newGrpcEndpoint = 'https://grpc.ny.shyft.to/';
        newRpcUrl = `https://rpc.shyft.to?api_key=${apiKey}`;
        break;
      case 'triton':
        newGrpcToken = apiKey;
        newGrpcEndpoint = 'https://api.mainnet.triton.one';
        newRpcUrl = 'https://api.mainnet-beta.solana.com'; // Use public RPC for Triton
        break;
    }

    // Replace GRPCTOKEN
    envContent = envContent.replace(
      /GRPCTOKEN=.*/,
      `GRPCTOKEN=${newGrpcToken}`
    );

    // Replace GRPC_ENDPOINT
    envContent = envContent.replace(
      /GRPC_ENDPOINT=.*/,
      `GRPC_ENDPOINT=${newGrpcEndpoint}`
    );

    // Replace RPC_URL (optional, keep if exists)
    if (envContent.includes('RPC_URL=')) {
      envContent = envContent.replace(
        /RPC_URL=.*/,
        `RPC_URL=${newRpcUrl}`
      );
    }

    // Write updated .env file
    fs.writeFileSync(envPath, envContent);

    console.log('\n✅ Successfully updated .env file!\n');
    console.log('Updated values:');
    console.log(`  GRPCTOKEN=${newGrpcToken.slice(0, 8)}...${newGrpcToken.slice(-4)}`);
    console.log(`  GRPC_ENDPOINT=${newGrpcEndpoint}`);
    console.log(`  RPC_URL=${newRpcUrl}\n`);

    console.log('🧪 Testing your new configuration...\n');

    // Test the token
    const testNow = await question('Test the token now? (yes/no): ');
    if (testNow.toLowerCase() === 'yes' || testNow.toLowerCase() === 'y') {
      console.log('\nRunning: node test_grpc_token.js\n');
      
      // Import and run test
      try {
        const { exec } = await import('child_process');
        exec('node test_grpc_token.js', (error, stdout, stderr) => {
          if (error) {
            console.error('❌ Test failed:', error.message);
            console.log('\n💡 Try running: node test_grpc_token.js manually\n');
          } else {
            console.log(stdout);
            if (stdout.includes('Your gRPC token is VALID and working')) {
              console.log('\n🎉 SUCCESS! Your bot is ready to start!');
              console.log('\n🚀 Start your bot with: npm start\n');
            } else {
              console.log('\n⚠️ Token test did not pass. Check the output above.\n');
            }
          }
          rl.close();
        });
      } catch (err) {
        console.log('\n💡 Manually test with: node test_grpc_token.js\n');
        rl.close();
      }
    } else {
      console.log('\n💡 Test manually with: node test_grpc_token.js');
      console.log('🚀 Then start your bot with: npm start\n');
      rl.close();
    }

  } catch (error) {
    console.error('\n❌ Error updating .env file:', error.message);
    console.log('💡 Please update .env manually using the guide in HOW_TO_GET_GRPC_TOKEN.md\n');
    rl.close();
  }
}

main();
