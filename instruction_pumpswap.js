import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import dotenv from "dotenv";
import { getAssociatedTokenAddress } from "@solana/spl-token";

dotenv.config();

const COMMITMENT_LEVEL = "confirmed";
const PUMP_SWAP_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const DIRECT_ADDED_PUMPSWAP = process.env.DIRECT_ADDED_PUMPSWAP === "true";
// Use a shared connection
const solanaConnection = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", COMMITMENT_LEVEL);

export async function createPumpSwapBuyInstruction(
  pool,
  user,
  baseMint,
  quoteMint,
  userBaseTokenAccount,
  userQuoteTokenAccount,
  protocolFeeRecipient,
  protocolFeeRecipientTokenAccount,
  coinCreator,
  baseAmountOut,
  maxQuoteAmountIn
) {
  // Convert to PublicKey and BN as needed
  const poolPubkey = typeof pool === "string" ? new PublicKey(pool) : pool;
  const userPubkey = typeof user === "string" ? new PublicKey(user) : user;
  const baseMintPubkey = typeof baseMint === "string" ? new PublicKey(baseMint) : baseMint;
  const quoteMintPubkey = typeof quoteMint === "string" ? new PublicKey(quoteMint) : quoteMint;
  const userBaseTokenAccountPubkey = typeof userBaseTokenAccount === "string" ? new PublicKey(userBaseTokenAccount) : userBaseTokenAccount;
  const userQuoteTokenAccountPubkey = typeof userQuoteTokenAccount === "string" ? new PublicKey(userQuoteTokenAccount) : userQuoteTokenAccount;
  const protocolFeeRecipientPubkey = typeof protocolFeeRecipient === "string" ? new PublicKey(protocolFeeRecipient) : protocolFeeRecipient;
  const protocolFeeRecipientTokenAccountPubkey = typeof protocolFeeRecipientTokenAccount === "string" ? new PublicKey(protocolFeeRecipientTokenAccount) : protocolFeeRecipientTokenAccount;
  const coinCreatorPubkey = typeof coinCreator === "string" ? new PublicKey(coinCreator) : coinCreator;

  // Derive baseTokenProgramPubkey and quoteTokenProgramPubkey
  const baseTokenProgramPubkey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const quoteTokenProgramPubkey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

  // Derive pool_base_token_account PDA
  const [poolBaseTokenAccountPubkey] = PublicKey.findProgramAddressSync(
    [
      poolPubkey.toBuffer(),
      baseTokenProgramPubkey.toBuffer(),
      baseMintPubkey.toBuffer(),
    ],
    new PublicKey([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131,
      11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
    ])
  );

  // Derive pool_quote_token_account PDA
  const [poolQuoteTokenAccountPubkey] = PublicKey.findProgramAddressSync(
    [
      poolPubkey.toBuffer(),
      quoteTokenProgramPubkey.toBuffer(),
      quoteMintPubkey.toBuffer(),
    ],
    new PublicKey([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131,
      11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
    ])
  );
 
  // coin_creator_vault_authority PDA: seeds = ["creator_vault", pool.coin_creator]
  const [coinCreatorVaultAuthorityPubkey] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        99, 114, 101, 97, 116, 111, 114, 95, 118, 97, 117, 108, 116
      ]), // "creator_vault"
      coinCreatorPubkey.toBuffer()
    ],
    PUMP_SWAP_PROGRAM_ID
  );
  // Derive coin_creator_vault_ata PDA: seeds = [coin_creator_vault_authority, quote_token_program, quote_mint]
  const [coinCreatorVaultAtaPubkey] = PublicKey.findProgramAddressSync(
    [
      coinCreatorVaultAuthorityPubkey.toBuffer(),
      quoteTokenProgramPubkey.toBuffer(),
      quoteMintPubkey.toBuffer()
    ],
    new PublicKey([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131,
      11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
    ])
  );


  // global_volume_accumulator PDA: seeds = ["global_volume_accumulator"]
  const [globalVolumeAccumulatorPubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from([
      103, 108, 111, 98, 97, 108, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99,
      99, 117, 109, 117, 108, 97, 116, 111, 114
    ])], // "global_volume_accumulator"
    PUMP_SWAP_PROGRAM_ID
  );

  // user_volume_accumulator PDA: seeds = ["user_volume_accumulator", user]
  const [userVolumeAccumulatorPubkey] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        117, 115, 101, 114, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99,
        117, 109, 117, 108, 97, 116, 111, 114
      ]), // "user_volume_accumulator"
      userPubkey.toBuffer()
    ],
    PUMP_SWAP_PROGRAM_ID
  );

  // global_config PDA: seeds = ["global_config"]
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from([103, 108, 111, 98, 97, 108, 95, 99, 111, 110, 102, 105, 103])], // "global_config"
    PUMP_SWAP_PROGRAM_ID
  );

  // event_authority PDA: seeds = ["__event_authority"]
  const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from([95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121])], // "__event_authority"
    PUMP_SWAP_PROGRAM_ID
  );

  const baseAmountOutBN = BN.isBN(baseAmountOut) ? baseAmountOut : new BN(baseAmountOut);
  const maxQuoteAmountInBN = BN.isBN(maxQuoteAmountIn) ? maxQuoteAmountIn : new BN(maxQuoteAmountIn);

  // Build keys array in correct order for PumpSwap buy instruction
  const keys = [
    { pubkey: poolPubkey, isSigner: false, isWritable: false },
    { pubkey: userPubkey, isSigner: true, isWritable: true },
    { pubkey: globalConfigPda, isSigner: false, isWritable: false },
    { pubkey: baseMintPubkey, isSigner: false, isWritable: false },
    { pubkey: quoteMintPubkey, isSigner: false, isWritable: false },
    { pubkey: userBaseTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: userQuoteTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: poolBaseTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: poolQuoteTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: protocolFeeRecipientPubkey, isSigner: false, isWritable: false },
    { pubkey: protocolFeeRecipientTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: baseTokenProgramPubkey, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgramPubkey, isSigner: false, isWritable: false },
    { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false }, // system_program
    { pubkey: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), isSigner: false, isWritable: false }, // associated_token_program
    { pubkey: eventAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: PUMP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: coinCreatorVaultAtaPubkey, isSigner: false, isWritable: true },
    { pubkey: coinCreatorVaultAuthorityPubkey, isSigner: false, isWritable: false },
  ];
  if (!DIRECT_ADDED_PUMPSWAP) {
    keys.push({ pubkey: globalVolumeAccumulatorPubkey, isSigner: false, isWritable: true });
    keys.push({ pubkey: userVolumeAccumulatorPubkey, isSigner: false, isWritable: true });
  }

  // Instruction data for buy
  const data = createPumpSwapBuyData(baseAmountOutBN, maxQuoteAmountInBN);

  return new TransactionInstruction({
    keys,
    programId: PUMP_SWAP_PROGRAM_ID,
    data,
  });
}

export async function createPumpSwapSellInstruction(
  pool,
  user,
  baseMint,
  quoteMint,
  userBaseTokenAccount,
  userQuoteTokenAccount,
  protocolFeeRecipient,
  protocolFeeRecipientTokenAccount,
  coinCreator,
  baseAmountIn,
  minQuoteAmountOut
 ) {
  // Convert to PublicKey and BN as needed
  const poolPubkey = typeof pool === "string" ? new PublicKey(pool) : pool;
  const userPubkey = typeof user === "string" ? new PublicKey(user) : user;
  const baseMintPubkey = typeof baseMint === "string" ? new PublicKey(baseMint) : baseMint;
  const quoteMintPubkey = typeof quoteMint === "string" ? new PublicKey(quoteMint) : quoteMint;
  const userBaseTokenAccountPubkey = typeof userBaseTokenAccount === "string" ? new PublicKey(userBaseTokenAccount) : userBaseTokenAccount;
  const userQuoteTokenAccountPubkey = typeof userQuoteTokenAccount === "string" ? new PublicKey(userQuoteTokenAccount) : userQuoteTokenAccount;

  // Derive baseTokenProgramPubkey and quoteTokenProgramPubkey
  const baseTokenProgramPubkey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const quoteTokenProgramPubkey = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

 
  // Derive coin_creator_vault_authority PDA: seeds = ["creator_vault", pool.coin_creator]
  const [coinCreatorVaultAuthorityPubkey] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        99, 114, 101, 97, 116, 111, 114, 95, 118, 97, 117, 108, 116
      ]), // "creator_vault"
      (typeof coinCreator === "string" ? new PublicKey(coinCreator) : coinCreator).toBuffer()
    ],
    PUMP_SWAP_PROGRAM_ID
  );

  // Derive coin_creator_vault_ata PDA: seeds = [coin_creator_vault_authority, quote_token_program, quote_mint]
  const [coinCreatorVaultAta] = PublicKey.findProgramAddressSync(
    [
      coinCreatorVaultAuthorityPubkey.toBuffer(),
      quoteTokenProgramPubkey.toBuffer(),
      quoteMintPubkey.toBuffer()
    ],
    new PublicKey([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131,
      11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
    ])
  );

  // Derive pool_base_token_account PDA
  const [poolBaseTokenAccountPubkey] = PublicKey.findProgramAddressSync(
    [
      poolPubkey.toBuffer(),
      baseTokenProgramPubkey.toBuffer(),
      baseMintPubkey.toBuffer(),
    ],
    new PublicKey([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131,
      11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
    ])
  );

  
  // Derive pool_quote_token_account PDA
  const [poolQuoteTokenAccountPubkey] = PublicKey.findProgramAddressSync(
    [
      poolPubkey.toBuffer(),
      quoteTokenProgramPubkey.toBuffer(),
      quoteMintPubkey.toBuffer(),
    ],
    new PublicKey([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131,
      11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
    ])
  );
  const protocolFeeRecipientPubkey = typeof protocolFeeRecipient === "string" ? new PublicKey(protocolFeeRecipient) : protocolFeeRecipient;
  const protocolFeeRecipientTokenAccountPubkey = typeof protocolFeeRecipientTokenAccount === "string" ? new PublicKey(protocolFeeRecipientTokenAccount) : protocolFeeRecipientTokenAccount;

  const baseAmountInBN = BN.isBN(baseAmountIn) ? baseAmountIn : new BN(baseAmountIn);
  const minQuoteAmountOutBN = BN.isBN(minQuoteAmountOut) ? minQuoteAmountOut : new BN(minQuoteAmountOut);

  // Derive PDAs
  // global_config PDA: seeds = ["global_config"]
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from([103, 108, 111, 98, 97, 108, 95, 99, 111, 110, 102, 105, 103])], // "global_config"
    PUMP_SWAP_PROGRAM_ID
  );

  // event_authority PDA: seeds = ["__event_authority"]
  const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from([95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121])], // "__event_authority"
    PUMP_SWAP_PROGRAM_ID
  );

  // global_volume_accumulator PDA: seeds = ["global_volume_accumulator"]
  const [globalVolumeAccumulatorPubkey] = PublicKey.findProgramAddressSync(
    [Buffer.from([
      103, 108, 111, 98, 97, 108, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99,
      99, 117, 109, 117, 108, 97, 116, 111, 114
    ])], // "global_volume_accumulator"
    PUMP_SWAP_PROGRAM_ID
  );

  // user_volume_accumulator PDA: seeds = ["user_volume_accumulator", user]
  const [userVolumeAccumulatorPubkey] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        117, 115, 101, 114, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99,
        117, 109, 117, 108, 97, 116, 111, 114
      ]), // "user_volume_accumulator"
      userPubkey.toBuffer()
    ],
    PUMP_SWAP_PROGRAM_ID
  );
 
  // Build keys array in correct order for PumpSwap sell instruction
  const keys = [
    { pubkey: poolPubkey, isSigner: false, isWritable:  false },
    { pubkey: userPubkey, isSigner: true, isWritable: true },
    { pubkey: globalConfigPda, isSigner: false, isWritable: false },
    { pubkey: baseMintPubkey, isSigner: false, isWritable: false },
    { pubkey: quoteMintPubkey, isSigner: false, isWritable: false },
    { pubkey: userBaseTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: userQuoteTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: poolBaseTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: poolQuoteTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: protocolFeeRecipientPubkey, isSigner: false, isWritable: false },
    { pubkey: protocolFeeRecipientTokenAccountPubkey, isSigner: false, isWritable: true },
    { pubkey: baseTokenProgramPubkey, isSigner: false, isWritable: false },
    { pubkey: quoteTokenProgramPubkey, isSigner: false, isWritable: false },
    { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false }, // system_program
    { pubkey: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), isSigner: false, isWritable: false }, // associated_token_program
    { pubkey: eventAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: PUMP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
    { pubkey: coinCreatorVaultAuthorityPubkey, isSigner: false, isWritable: false },
     
  ];
  if (!DIRECT_ADDED_PUMPSWAP) {
    keys.push({ pubkey: globalVolumeAccumulatorPubkey, isSigner: false, isWritable: true });
    keys.push({ pubkey: userVolumeAccumulatorPubkey, isSigner: false, isWritable: true });
  }

  // Instruction data for sell
  const data = createPumpSwapSellData(baseAmountInBN, minQuoteAmountOutBN);

  return new TransactionInstruction({
    keys,
    programId: PUMP_SWAP_PROGRAM_ID,
    data,
  });
}

function createPumpSwapBuyData(baseAmountOut, maxQuoteAmountIn) {
  // Buy discriminator: [102, 6, 61, 18, 1, 218, 235, 234]
  const buyDiscriminator = [102, 6, 61, 18, 1, 218, 235, 234];
  
  // Ensure we have BN objects
  const baseAmountOutBN = BN.isBN(baseAmountOut) ? baseAmountOut : new BN(baseAmountOut.toString());
  const maxQuoteAmountInBN = BN.isBN(maxQuoteAmountIn) ? maxQuoteAmountIn : new BN(maxQuoteAmountIn.toString());
  
  const baseAmountOutBytes = baseAmountOutBN.toArray("le", 8);
  const maxQuoteAmountInBytes = maxQuoteAmountInBN.toArray("le", 8);
  return Buffer.from([...buyDiscriminator, ...baseAmountOutBytes, ...maxQuoteAmountInBytes]);
}

function createPumpSwapSellData(baseAmountIn, minQuoteAmountOut) {
  // Sell discriminator: [51, 230, 133, 164, 1, 127, 131, 173]
  const sellDiscriminator = [51, 230, 133, 164, 1, 127, 131, 173];
  
  // Ensure we have BN objects
  const baseAmountInBN = BN.isBN(baseAmountIn) ? baseAmountIn : new BN(baseAmountIn.toString());
  const minQuoteAmountOutBN = BN.isBN(minQuoteAmountOut) ? minQuoteAmountOut : new BN(minQuoteAmountOut.toString());
  
  const baseAmountInBytes = baseAmountInBN.toArray("le", 8);
  const minQuoteAmountOutBytes = minQuoteAmountOutBN.toArray("le", 8);
  return Buffer.from([...sellDiscriminator, ...baseAmountInBytes, ...minQuoteAmountOutBytes]);
}
