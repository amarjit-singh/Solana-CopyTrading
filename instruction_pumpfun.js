import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
// import { transactionFromInstructions } from "@pump-fun/pump-swap-sdk";
import dotenv from "dotenv";
import { getAssociatedTokenAddress } from "@solana/spl-token";

dotenv.config();
// PRI
const COMMITMENT_LEVEL = "confirmed";
const PUMP_FUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"; // or the correct program id

// Use a shared connection
const solanaConnection = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", COMMITMENT_LEVEL);

  // Function to create PumpFun buy instruction with exact structure based on IDL
  export async function createPumpFunBuyInstruction(mint, solAmount, tokenAmount, user, creator, feeRecipient, userAta) {

    // Convert amounts to proper format
    const solAmountBN = new BN(solAmount);
    const tokenAmountBN = new BN(tokenAmount);
  
    // Derive PDAs based on IDL specification
    const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  
    const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;
  
    const userPubkey = typeof user === 'string' ? new PublicKey(user) : user;
  
    // console.log("Creating creatorPubkey from:", creator);
    const creatorPubkey = typeof creator === 'string' ? new PublicKey(creator) : creator;
  
    // console.log("Creating feeRecipientPubkey from:", feeRecipient);
    const feeRecipientPubkey = typeof feeRecipient === 'string' ? new PublicKey(feeRecipient) : feeRecipient;
  
    // Derive global PDA: seeds = ["global"]
    const [globalPda] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_FUN_PROGRAM);
  
    // Derive bonding curve PDA: seeds = ["bonding-curve", mint]
    const [bondingCurvePda] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintPubkey.toBuffer()], PUMP_FUN_PROGRAM);
  
    // Derive associated bonding curve PDA: seeds = [bonding_curve, specific_seed, mint]
    const associatedBondingCurveSeed = Buffer.from([
      6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126,
      255, 0, 169,
    ]);
    const associatedBondingCurveProgramId = new PublicKey(Uint8Array.from([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89
    ]));
    const [associatedBondingCurvePda] = PublicKey.findProgramAddressSync(
      [bondingCurvePda.toBuffer(), associatedBondingCurveSeed, mintPubkey.toBuffer()],
      associatedBondingCurveProgramId
    );
  
    // Derive creator vault PDA: seeds = ["creator-vault", creator]
    const [creatorVaultPda] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creatorPubkey.toBuffer()], PUMP_FUN_PROGRAM);
  
    // Derive event authority PDA: seeds = ["__event_authority"]
    const [eventAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_FUN_PROGRAM);
  
    // Derive coin_creator_vault_ata (creator's ATA for the mint)
    // const coinCreatorVaultAta = await getAssociatedTokenAddress(mintPubkey, creatorPubkey);
    // Derive global_volume_accumulator PDA: seeds = ["global_volume_accumulator"]
    const [globalVolumeAccumulatorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from([
        103, 108, 111, 98, 97, 108, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99, 117, 109, 117, 108, 97, 116, 111, 114
      ])],
      PUMP_FUN_PROGRAM
    );
    // Derive user_volume_accumulator PDA: seeds = [user, mint]
    const [userVolumeAccumulatorPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from([
          117, 115, 101, 114, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99, 117, 109, 117, 108, 97, 116, 111, 114
        ]),
        userPubkey.toBuffer()
      ],
      PUMP_FUN_PROGRAM
    );

    // Create the instruction structure based on IDL account order
    const instruction = {
      keys: [
        {
          pubkey: globalPda, // global
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: feeRecipientPubkey, // fee_recipient
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: mintPubkey, // mint
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: bondingCurvePda, // bonding_curve
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: associatedBondingCurvePda, // associated_bonding_curve
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: userAta, // associated_user
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: userPubkey, // user
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: new PublicKey("11111111111111111111111111111111"), // system_program
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), // token_program
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: creatorVaultPda, // creator_vault
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: eventAuthorityPda, // event_authority
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: PUMP_FUN_PROGRAM, // program
          isSigner: false,
          isWritable: false,
        },
        // {
        //   pubkey: coinCreatorVaultAta, // coin_creator_vault_ata
        //   isSigner: false,
        //   isWritable: true,
        // },
        // {
        //   pubkey: creatorPubkey, // coin_creator_vault_authority
        //   isSigner: false,
        //   isWritable: false,
        // },
        {
          pubkey: globalVolumeAccumulatorPda, // global_volume_accumulator
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: userVolumeAccumulatorPda, // user_volume_accumulator
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"), // fee_config
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"), // fee_program
          isSigner: false,
          isWritable: false,
        },
      ],
      programId: PUMP_FUN_PROGRAM,
      data: createBuyInstructionData(tokenAmountBN, solAmountBN),
    };
  
    return instruction;
  }
  
  // Function to create the instruction data for buy operation
  function createBuyInstructionData(tokenAmount, solAmount) {
    // Buy discriminator: [102, 6, 61, 18, 1, 218, 235, 234]
    const buyDiscriminator = [102, 6, 61, 18, 1, 218, 235, 234];
  
    // Convert amounts to little-endian bytes
    const tokenAmountBytes = tokenAmount.toArray("le", 8);
    const solAmountBytes = solAmount.toArray("le", 8);
  
        // Combine discriminator + token amount + SOL amount
    const data = [...buyDiscriminator, ...tokenAmountBytes, ...solAmountBytes];

    return Buffer.from(data);
  }
  
  // Function to create PumpFun sell instruction with exact structure based on IDL
  export async function createPumpFunSellInstruction(mint, solAmount, tokenAmount, user, creator, feeRecipient, userAta) {
    // Convert amounts to proper format
    const solAmountBN = new BN(solAmount);
    const tokenAmountBN = new BN(tokenAmount);
  
    // Derive PDAs based on IDL specification
    const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;
    const userPubkey = typeof user === 'string' ? new PublicKey(user) : user;
    const creatorPubkey = typeof creator === 'string' ? new PublicKey(creator) : creator;
    const feeRecipientPubkey = typeof feeRecipient === 'string' ? new PublicKey(feeRecipient) : feeRecipient;
  
    // Derive global PDA: seeds = ["global"]
    const [globalPda] = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP_FUN_PROGRAM);
  
    // Derive bonding curve PDA: seeds = ["bonding-curve", mint]
    const [bondingCurvePda] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintPubkey.toBuffer()], PUMP_FUN_PROGRAM);
  
    // Derive associated bonding curve PDA: seeds = [bonding_curve, specific_seed, mint]
    const associatedBondingCurveSeed = Buffer.from([
      6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126,
      255, 0, 169,
    ]);
    const associatedBondingCurveProgramId = new PublicKey(Uint8Array.from([
      140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89
    ]));
    const [associatedBondingCurvePda] = PublicKey.findProgramAddressSync(
      [bondingCurvePda.toBuffer(), associatedBondingCurveSeed, mintPubkey.toBuffer()],
      associatedBondingCurveProgramId
    );
  
    // Derive user associated token account
    // const userAta = await getAssociatedTokenAddress(mintPubkey, userPubkey);
  
    // Derive creator vault PDA: seeds = ["creator-vault", creator]
    const [creatorVaultPda] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creatorPubkey.toBuffer()], PUMP_FUN_PROGRAM);
  
    // Derive event authority PDA: seeds = ["__event_authority"]
    const [eventAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_FUN_PROGRAM);

    // Derive coin_creator_vault_ata (creator's ATA for the mint)
    // const coinCreatorVaultAta = await getAssociatedTokenAddress(mintPubkey, creatorPubkey);

    // Derive global_volume_accumulator PDA: seeds = ["global_volume_accumulator"]
    // const [globalVolumeAccumulatorPda] = PublicKey.findProgramAddressSync(
    //   [Buffer.from([
    //     103, 108, 111, 98, 97, 108, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99, 117, 109, 117, 108, 97, 116, 111, 114
    //   ])],
    //   PUMP_FUN_PROGRAM
    // );

    // // Derive user_volume_accumulator PDA: seeds = [Buffer.from("user_volume_accumulator"), user]
    // const [userVolumeAccumulatorPda] = PublicKey.findProgramAddressSync(
    //   [
    //     Buffer.from([
    //       117, 115, 101, 114, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99, 117, 109, 117, 108, 97, 116, 111, 114
    //     ]),
    //     userPubkey.toBuffer()
    //   ],
    //   PUMP_FUN_PROGRAM
    // );

    // Create the instruction structure based on IDL account order for sell
    const instruction = {
      keys: [
        {
          pubkey: globalPda, // global
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: feeRecipientPubkey, // fee_recipient
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: mintPubkey, // mint
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: bondingCurvePda, // bonding_curve
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: associatedBondingCurvePda, // associated_bonding_curve
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: userAta, // associated_user
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: userPubkey, // user
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: new PublicKey("11111111111111111111111111111111"), // system_program
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: creatorVaultPda, // creator_vault
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), // token_program
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: eventAuthorityPda, // event_authority
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: PUMP_FUN_PROGRAM, // program
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"), // fee_config
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"), // fee_program
          isSigner: false,
          isWritable: false,
        },
        // {
        //   pubkey: coinCreatorVaultAta, // coin_creator_vault_ata
        //   isSigner: false,
        //   isWritable: true,
        // },
        // {
        //   pubkey: creatorPubkey, // coin_creator_vault_authority
        //   isSigner: false,
        //   isWritable: false,
        // },
        // {
        //   pubkey: globalVolumeAccumulatorPda, // global_volume_accumulator
        //   isSigner: false,
        //   isWritable: true,
        // },
        // {
        //   pubkey: userVolumeAccumulatorPda, // user_volume_accumulator
        //   isSigner: false,
        //   isWritable: true,
        // },
      ],
      programId: PUMP_FUN_PROGRAM,
      data: createSellInstructionData(tokenAmountBN, solAmountBN),
    };
  
    return instruction;
  }
  
  // Function to create the instruction data for sell operation
  function createSellInstructionData(tokenAmount, solAmount) {
    // Sell discriminator: [51, 230, 133, 164, 1, 127, 131, 173]
    const sellDiscriminator = [51, 230, 133, 164, 1, 127, 131, 173];
  
    // Convert amounts to little-endian bytes
    const tokenAmountBytes = tokenAmount.toArray("le", 8);
    const solAmountBytes = solAmount.toArray("le", 8);
  
        // Combine discriminator + token amount + SOL amount
    const data = [...sellDiscriminator, ...tokenAmountBytes, ...solAmountBytes];

    return Buffer.from(data);
  }
 