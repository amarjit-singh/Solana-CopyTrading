import bs58 from "bs58";
import dotenv from "dotenv";
dotenv.config();
const DIRECT_ADDED_PUMPSWAP = process.env.DIRECT_ADDED_PUMPSWAP === "true";

// New function to handle parsed transaction data from getDataFromTx
export async function parseTransactionFromData(parsedTx) {
  if (!parsedTx) return null;

  const meta = parsedTx.meta;
  const transaction = parsedTx.transaction;
  
  // Extract signature if available
  let signature = null;
  try {
    if (transaction?.signatures && transaction.signatures.length > 0) {
      signature = transaction.signatures[0];
    }
  } catch (err) {
    console.warn("Could not extract signature from parsed transaction");
  }

  const innerInstructions = meta.innerInstructions;
  const flattenedInnerInstructions = (await innerInstructions?.flatMap((ix) => ix.instructions || [])) || [];
  const allInstructions = [...flattenedInnerInstructions];
  // console.log(allInstructions)
  if (allInstructions.length === 0) return null;

  // Filter out instructions that don't have data property
  const validInstructions = allInstructions.filter((instruction) => instruction && instruction.data);

  if (validInstructions.length === 0) return null;

  // Try to extract account keys for program ID detection FIRST
  const accountKeys = parsedTx?.transaction?.message?.accountKeys
                   || parsedTx?.transaction?.message?.staticAccountKeys;

  // Known platform program IDs to search for
  const PLATFORM_PROGRAM_IDS = [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Pump.fun
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',  // Raydium AMM
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',  // Raydium CPMM
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium CLMM
  ];

  // Token program IDs to IGNORE
  const TOKEN_PROGRAM_IDS = [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    '11111111111111111111111111111111',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  ];

  // BETTER APPROACH: Find instruction by platform program ID first
  let targetInstruction = null;
  let detectedPlatform = null;

  if (accountKeys) {
    for (const instruction of validInstructions) {
      if (instruction.programIdIndex !== undefined) {
        const programId = accountKeys[instruction.programIdIndex];

        // Check if this is a platform program (not a token program)
        if (PLATFORM_PROGRAM_IDS.includes(programId)) {
          targetInstruction = instruction;
          detectedPlatform = programId;
          break; // Found it, stop searching
        }
      }
    }
  }

  // FALLBACK: If no platform program found, use largest data instruction
  if (!targetInstruction) {
    targetInstruction = validInstructions.reduce((largest, current) => {
      if (!current || !current.data || !largest || !largest.data) {
        return largest || current;
      }
      return current.data.length > largest.data.length ? current : largest;
    });
  }
  // console.log(targetInstruction)

  if (!targetInstruction || !targetInstruction.data) {
    return null;
  }

  const programIdIndex = targetInstruction.programIdIndex;

  // console.log(targetInstruction.data)
  const rawData = bs58.decode(targetInstruction.data);
  const buffer = Buffer.from(rawData);
  // console.log(buffer)

  const parsedInstructionData = parseTransactionData(buffer, accountKeys, programIdIndex);
  // console.log(parsedInstructionData)

  if (!parsedInstructionData) return null;

  return {
    solChanges: parseFloat(parsedInstructionData.solchange),
    tokenChanges: parseFloat(parsedInstructionData.tokenchange),
    isBuy: parsedInstructionData.isBuy,
    user: parsedInstructionData.user,
    mint: parsedInstructionData.mint,
    pool: parsedInstructionData.pool,
    liquidity: parsedInstructionData.liquidity,
    coinCreator: parsedInstructionData.coinCreator,
    pool_status: parsedInstructionData.pool_status,
    signature: signature,
    context: parsedInstructionData.context,
  };
}

export async function tOutPut(data) {
  // Check if this is parsed transaction data from getDataFromTx
  if (data && data.meta && data.transaction) {
    // This is parsed transaction data from getDataFromTx
    return await parseTransactionFromData(data);
  }

  // Original format handling
  const dataTx = data?.transaction?.transaction;
  if (!dataTx) return;
  const signature = bs58.encode(Buffer.from(dataTx?.transaction.signatures?.[0]));
  // console.log("signature:::", signature);

  // DEBUG: Log transaction structure to find accountKeys location
  // console.log("🔍 Transaction structure:", JSON.stringify({
  //   hasMessage: !!dataTx?.transaction?.message,
  //   hasAccountKeys: !!dataTx?.transaction?.message?.accountKeys,
  //   messageKeys: dataTx?.transaction?.message ? Object.keys(dataTx.transaction.message) : [],
  //   transactionKeys: dataTx?.transaction ? Object.keys(dataTx.transaction) : []
  // }, null, 2));

  const meta = dataTx?.meta;
  const logs = meta?.logMessages;
  const logFilter = logs?.some((instruction) => instruction.match(instruction.match(/MintTo/i)));

  const innerInstructions = meta.innerInstructions;
  // console.log(innerInstructions)
  const flattenedInnerInstructions = (await innerInstructions?.flatMap((ix) => ix.instructions || [])) || [];
  // console.log(flattenedInnerInstructions)
  const allInstructions = [...flattenedInnerInstructions];
  // console.log("allInstructions",allInstructions)

  if (allInstructions.length === 0) return;

  // Filter out instructions that don't have data property
  const validInstructions = allInstructions.filter((instruction) => instruction && instruction.data);

  if (validInstructions.length === 0) return null;

  // Try to get account keys from transaction message FIRST
  const accountKeys = dataTx?.transaction?.message?.accountKeys
                   || dataTx?.transaction?.message?.staticAccountKeys
                   || data?.transaction?.transaction?.transaction?.message?.accountKeys;

  // Known platform program IDs to search for
  const PLATFORM_PROGRAM_IDS = [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Pump.fun
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',  // Raydium AMM
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',  // Raydium CPMM
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium CLMM
  ];

  // Token program IDs to IGNORE
  const TOKEN_PROGRAM_IDS = [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    '11111111111111111111111111111111',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  ];

  // BETTER APPROACH: Find instruction by platform program ID first
  let targetInstruction = null;
  let detectedPlatform = null;

  if (accountKeys) {
    console.log(`🔍 Searching through ${validInstructions.length} instructions for DEX program...`);

    for (const instruction of validInstructions) {
      if (instruction.programIdIndex !== undefined) {
        const programId = accountKeys[instruction.programIdIndex];
        console.log(`  📋 Instruction programId: ${programId}, data length: ${instruction.data.length}`);

        // Check if this is a platform program (not a token program)
        if (PLATFORM_PROGRAM_IDS.includes(programId)) {
          targetInstruction = instruction;
          detectedPlatform = programId;
          console.log(`  ✅ Found DEX instruction! Platform: ${programId}`);
          break; // Found it, stop searching
        } else if (TOKEN_PROGRAM_IDS.includes(programId)) {
          console.log(`  ⏭️  Skipping token program: ${programId}`);
        } else {
          console.log(`  ❓ Unknown program: ${programId}`);
        }
      }
    }
  }

  // FALLBACK: If no platform program found, use largest data instruction
  if (!targetInstruction) {
    console.log("⚠️ No platform program found, falling back to largest data instruction");
    targetInstruction = validInstructions.reduce((largest, current) => {
      if (!current || !current.data || !largest || !largest.data) {
        return largest || current;
      }
      return current.data.length > largest.data.length ? current : largest;
    });
  }

  if (!targetInstruction || !targetInstruction.data) {
    return null;
  }

  console.log(`🎯 Using instruction: programId=${detectedPlatform || 'unknown'}, data.length=${targetInstruction.data.length}`);

  // console.log("🎈🎈🎈targetInstruction:::", targetInstruction.data);
  const parsedInstructionData = parseTransactionData(targetInstruction.data, accountKeys, targetInstruction.programIdIndex);
  // console.log("🎈",JSON.stringify(parsedInstructionData,null,2))

  if (!parsedInstructionData) return null;

  // console.log(parsedInstructionData);
  // console.log("Mint>>>>>>>>", parsedInstructionData.mint);
  return {
    solChanges: parseFloat(parsedInstructionData.solchange),
    tokenChanges: parseFloat(parsedInstructionData.tokenchange),
    isBuy: parsedInstructionData.isBuy,
    user: parsedInstructionData.user,
    mint: parsedInstructionData.mint,
    pool: parsedInstructionData.pool,
    liquidity: parsedInstructionData.liquidity / 10 ** 9,
    coinCreator: parsedInstructionData.coinCreator,
    pool_status: parsedInstructionData.pool_status,
    signature: signature,
    context: parsedInstructionData.context,
  };
  // console.log("Signature>>>>>>>>", signature);
}

export function parseTransactionData(buffer, accountKeys = null, programIdIndex = null) {
  try {
    // Known platform program IDs
    const PLATFORM_PROGRAMS = {
      PUMPFUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      RAYDIUM_CPMM: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
      RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
    };

    // Token program IDs to IGNORE
    const TOKEN_PROGRAMS = {
      TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      SYSTEM_PROGRAM: '11111111111111111111111111111111',
      ASSOCIATED_TOKEN: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    };

    // Try to get program ID from accountKeys
    let detectedProgramId = null;
    if (accountKeys && programIdIndex !== null && programIdIndex !== undefined) {
      detectedProgramId = accountKeys[programIdIndex];
      console.log(`🔍 Program ID from instruction: ${detectedProgramId}`);

      // CHECK: Make sure this is NOT a token program (we want the DEX program)
      const isTokenProgram = Object.values(TOKEN_PROGRAMS).includes(detectedProgramId);
      if (isTokenProgram) {
        console.log(`⚠️ Skipping token program ID: ${detectedProgramId}`);
        detectedProgramId = null; // Reset so we fall back to buffer length
      }
    }

    function parsePublicKey(offset) {
      return bs58.encode(buffer.slice(offset, offset + 32)); // Convert 32 bytes to Base58
    }

    function parseBigInt(offset) {
      return buffer.readBigUInt64LE(offset).toString(); // Read 8 bytes as Little-Endian
    }

    // ========================================================================
    // PLATFORM DETECTION: Use Program ID (most reliable method)
    // ========================================================================
    if (detectedProgramId) {
      if (detectedProgramId === PLATFORM_PROGRAMS.PUMPFUN) {
        console.log(`✅ Detected PUMP.FUN by Program ID`);
        // Continue to pump.fun parsing logic (will hit buffer.length check below)
        // This confirms it's pump.fun before we parse the specific format
      } else if (detectedProgramId === PLATFORM_PROGRAMS.RAYDIUM_AMM) {
        console.log(`✅ Detected RAYDIUM AMM by Program ID`);
        // Continue to Raydium parsing
      } else if (detectedProgramId === PLATFORM_PROGRAMS.RAYDIUM_CPMM ||
                 detectedProgramId === PLATFORM_PROGRAMS.RAYDIUM_CLMM) {
        console.log(`✅ Detected RAYDIUM CPMM/CLMM by Program ID`);
      } else {
        console.log(`⚠️ Unknown DEX Program ID: ${detectedProgramId}`);
      }
    } else {
      console.log(`⚠️ No Program ID available, falling back to buffer length detection`);
    }

    // ========================================================================
    // FALLBACK: Buffer Length Detection (backwards compatibility)
    // ========================================================================
    if (buffer.length == 368) {
      const parsedData_PumpSwap = {
        mint: null,
        timestamp: parseBigInt(16), // 8 bytes (Timestamp)
        baseAmountIn: parseBigInt(24), // 8 bytes (Base amount in)
        minQuoteAmountOut: parseBigInt(32), // 8 bytes (Minimum quote amount out)
        userBaseTokenReserves: parseBigInt(40), // 8 bytes (User base token reserves)
        userQuoteTokenReserves: parseBigInt(48), // 8 bytes (User quote token reserves)
        poolBaseTokenReserves: parseBigInt(56), // 8 bytes (Pool base token reserves)
        poolQuoteTokenReserves: parseBigInt(64), // 8 bytes (Pool quote token reserves)
        quoteAmountOut: parseBigInt(72), // 8 bytes (Quote amount out)
        lpFeeBasisPoints: parseBigInt(80), // 8 bytes (LP fee basis points)
        lpFee: parseBigInt(88), // 8 bytes (LP fee)
        protocolFeeBasisPoints: parseBigInt(96), // 8 bytes (Protocol fee basis points)
        protocolFee: parseBigInt(104), // 8 bytes (Protocol fee)
        quoteAmountOutWithoutLpFee: parseBigInt(112), // 8 bytes (Quote amount out without LP fee)
        userQuoteAmountOut: parseBigInt(120), // 8 bytes (User quote amount out)
        pool: parsePublicKey(128), // 32 bytes (Pool address)
        user: parsePublicKey(160), // 32 bytes (User address)
        userBaseTokenAccount: parsePublicKey(192), // 32 bytes (User base token account)
        userQuoteTokenAccount: parsePublicKey(224), // 32 bytes (User quote token account)
        protocolFeeRecipient: parsePublicKey(256), // 32 bytes (Protocol fee recipient)
        protocolFeeRecipientTokenAccount: parsePublicKey(288), // 32 bytes (Protocol fee recipient token account)
        coinCreator: parsePublicKey(320), // 32 bytes (Coin creator address)
        coinCreatorFeeBasisPoints: parseBigInt(328), // 8 bytes (Coin creator fee basis points)
        coinCreatorFee: parseBigInt(336), // 8 bytes (Coin creator fee)
      };
      // console.log(parsedData_PumpSwap);
      let isBuy = parsedData_PumpSwap.quoteAmountOutWithoutLpFee > parsedData_PumpSwap.quoteAmountOut;
      // In this case, revert the quote and base address, and also swap the amounts
      if (DIRECT_ADDED_PUMPSWAP) {
        // Swap userBaseTokenAccount and userQuoteTokenAccount, and swap base/quote amounts in context and output
        const revertedContext = {
          ...parsedData_PumpSwap,
          userBaseTokenAccount: parsedData_PumpSwap.userQuoteTokenAccount,
          userQuoteTokenAccount: parsedData_PumpSwap.userBaseTokenAccount,
          baseAmountIn: parsedData_PumpSwap.quoteAmountOut,
          quoteAmountOut: parsedData_PumpSwap.baseAmountIn,
          poolBaseTokenReserves: parsedData_PumpSwap.poolQuoteTokenReserves,
          poolQuoteTokenReserves: parsedData_PumpSwap.poolBaseTokenReserves,
        };
        return {
          solchange: parsedData_PumpSwap.baseAmountIn, // swapped
          tokenchange: parsedData_PumpSwap.userQuoteAmountOut, // swapped
          isBuy: !isBuy, // also flip isBuy
          user: parsedData_PumpSwap.user,
          mint: parsedData_PumpSwap.mint,
          pool: parsedData_PumpSwap.pool,
          liquidity: parsedData_PumpSwap.poolBaseTokenReserves * 2, // swapped
          coinCreator: parsedData_PumpSwap.coinCreator,
          pool_status: "pumpswap",
          context: revertedContext,
        };
      }
      else
      return {
        solchange: parsedData_PumpSwap.userQuoteAmountOut,
        tokenchange: parsedData_PumpSwap.baseAmountIn,
        isBuy,
        user: parsedData_PumpSwap.user,
        mint: parsedData_PumpSwap.mint,
        pool: parsedData_PumpSwap.pool,
        liquidity: parsedData_PumpSwap.poolQuoteTokenReserves * 2,
        coinCreator: parsedData_PumpSwap.coinCreator,
        pool_status: "pumpswap",
        context: parsedData_PumpSwap,
      };
    } else if (buffer.length == 266 || buffer.length == 273 || buffer.length == 274 || buffer.length == 275) {
      // Support pump.fun formats: 266 (original), 273, 274, 275 (new variants)
      const parsedData_PumpFun = {
        mint: parsePublicKey(16), // 32 bytes (Mint address)
        solAmount: parseBigInt(48), // 8 bytes (Amount in SOL)
        tokenAmount: parseBigInt(56), // 8 bytes (Token amount)
        isBuy: buffer[64] === 1, // 1 byte (Boolean: 0 = Sell, 1 = Buy)
        user: parsePublicKey(65), // 32 bytes (User address)
        timestamp: parseBigInt(97), // 8 bytes (Timestamp - Unix format)
        virtualSolReserves: parseBigInt(105), // 8 bytes (Virtual reserves)
        virtualTokenReserves: parseBigInt(113), // 8 bytes (Virtual token reserves)
        realSolReserves: parseBigInt(121), // 8 bytes (Real reserves)
        realTokenReserves: parseBigInt(129), // 8 bytes (Real token reserves)
        feeRecipient: parsePublicKey(137), // 32 bytes (Fee recipient address)
        feeBasisPoints: parseBigInt(169), // 8 bytes (Fee basis points)
        fee: parseBigInt(177), // 8 bytes (Fee amount)
        creator: parsePublicKey(185), // 32 bytes (Creator address)
        creatorFeeBasisPoints: parseBigInt(217), // 8 bytes (Creator fee basis points)
        creatorFee: parseBigInt(225), // 8 bytes (Creator fee amount)
        trackVolume: buffer[232] === 1,
        totalUnclaimedTokens: parseBigInt(233),
        totalClaimedTokens: parseBigInt(241),
        currentSolVolume: parseBigInt(249),
        lastUpdateTimestamp: parseBigInt(257),
      };
      // console.log(parsedData_PumpFun);

      let isBuy = parsedData_PumpFun.isBuy;
      
      // Debug: Log pump.fun transaction detection
      console.log(`🔍 PUMP.FUN DETECTED (buffer.length=${buffer.length}): isBuy=${isBuy}, user=${parsedData_PumpFun.user?.slice(0,8)}..., mint=${parsedData_PumpFun.mint?.slice(0,8)}...`);

      return {
        solchange: parsedData_PumpFun.solAmount,
        tokenchange: parsedData_PumpFun.tokenAmount,
        isBuy,
        user: parsedData_PumpFun.user,
        mint: parsedData_PumpFun.mint,
        pool: null,
        liquidity: parsedData_PumpFun.virtualSolReserves,
        coinCreator: parsedData_PumpFun.creator,
        pool_status: "pumpfun",
        context: parsedData_PumpFun,
      };
    } else if (buffer.length == 146) {
      const parsedData_Raydium_LaunchLab = {
        poolState: parsePublicKey(16), // 32 bytes (Pool state address)
        totalBaseSell: parseBigInt(48), // 8 bytes (Total base sold)
        virtualBase: parseBigInt(56), // 8 bytes (Virtual base reserves)
        virtualQuote: parseBigInt(64), // 8 bytes (Virtual quote reserves)
        realBaseBefore: parseBigInt(72), // 8 bytes (Real base before)
        realQuoteBefore: parseBigInt(80), // 8 bytes (Real quote before)
        realBaseAfter: parseBigInt(88), // 8 bytes (Real base after)
        realQuoteAfter: parseBigInt(96), // 8 bytes (Real quote after)
        amountIn: parseBigInt(104), // 8 bytes (Amount in)
        amountOut: parseBigInt(112), // 8 bytes (Amount out)
        protocolFee: parseBigInt(120), // 8 bytes (Protocol fee)
        platformFee: parseBigInt(128), // 8 bytes (Platform fee)
        shareFee: parseBigInt(136), // 8 bytes (Share fee)
        tradeDirection: buffer[144] , // 1 byte (1 = sell, 0 = buy)
        poolStatus: buffer[145] === 0 ? { normal: {} } : { fund: {} }, // 1 byte (0 = normal, 1 = fund)
      };
      const isBuy = !parsedData_Raydium_LaunchLab.tradeDirection;
      let solAmount = 0;
      let tokenAmount = 0;
      // console.log("🎈🎈🎈parsedData_Raydium_LaunchLab:::", parsedData_Raydium_LaunchLab);
      if (isBuy){
        solAmount = parsedData_Raydium_LaunchLab.amountIn;
        tokenAmount = parsedData_Raydium_LaunchLab.amountOut;
      }else{
        solAmount = parsedData_Raydium_LaunchLab.amountOut;
        tokenAmount = parsedData_Raydium_LaunchLab.amountIn;
      }

      // Return parsed Raydium data - user/mint will be extracted from metadata in main.js
      return {
        solchange: solAmount,
        tokenchange: tokenAmount,
        isBuy,
        user: null, // Will be extracted from transaction metadata
        mint: null, // Will be extracted from transaction metadata
        pool: parsedData_Raydium_LaunchLab.poolState,
        liquidity: 2*parsedData_Raydium_LaunchLab.realQuoteAfter,
        coinCreator: parsedData_Raydium_LaunchLab.poolState,
        pool_status: "raydium_launchlab",
        context: parsedData_Raydium_LaunchLab,
      };
    } else  {
      // Unknown Raydium format - user/mint will be extracted from metadata in main.js
      console.log(`⚠️ Unknown transaction format (buffer.length=${buffer.length}), attempting metadata extraction`);
      return {
        solchange: 0,
        tokenchange: 0,
        isBuy: false,
        user: null, // Will be extracted from transaction metadata
        mint: null, // Will be extracted from transaction metadata
        pool: null,
        liquidity: 0,
        coinCreator: null,
        pool_status: "raydium",
        context: null,
      };
  } }catch (error) {
    console.error("Error parsing transaction data:", error);
    return null;
  }
}
