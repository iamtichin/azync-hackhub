import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { generateSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createTreeV2, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import { base58 } from '@metaplex-foundation/umi/serializers';

async function loadOrGenerateKeypair(
  keypairPath: string,
  umi: ReturnType<typeof createUmi>,
): Promise<{ secretKey: Uint8Array; publicKey: string }> {
  try {
    // Try to load existing keypair
    const contents = await readFile(keypairPath, 'utf8');
    const bytes = JSON.parse(contents) as number[];

    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error('Invalid Solana keypair: expected an array of 64 bytes');
    }

    const secretKey = Uint8Array.from(bytes);
    const keypair = umi.eddsa.createKeypairFromSecretKey(secretKey);

    return {
      secretKey,
      publicKey: keypair.publicKey.toString(),
    };
  } catch (error) {
    // Generate new keypair if file doesn't exist
    const keypair = generateSigner(umi);
    const secretKeyArray = Array.from(keypair.secretKey);

    await writeFile(keypairPath, JSON.stringify(secretKeyArray, null, 2));

    return {
      secretKey: keypair.secretKey,
      publicKey: keypair.publicKey.toString(),
    };
  }
}

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const keypairPath = process.env.SOLANA_AUTHORITY_KEYPAIR_PATH || './keypair.json';

  // Check if keypair exists BEFORE loading/generating
  const keypairExists = existsSync(keypairPath);

  // 1. Initialize Umi and Bubblegum plugin
  const umi = createUmi(rpcUrl).use(mplBubblegum());

  // 2. Load or generate payer keypair
  const { secretKey, publicKey } = await loadOrGenerateKeypair(keypairPath, umi);

  const payerKeypair = umi.eddsa.createKeypairFromSecretKey(secretKey);
  umi.use(keypairIdentity(payerKeypair));

  console.log('✅ Payer address:', publicKey);

  // If keypair was just generated, prompt for funding
  if (!keypairExists) {
    console.log('🔑 Generated new keypair:', keypairPath);
    console.log('⚠️  Fund this wallet with devnet SOL: https://faucet.solana.com');
    console.log('\nAfter funding, run this script again to create the Merkle tree.');
    return;
  }

  // 3. Generate signer for Merkle Tree account
  const merkleTree = generateSigner(umi);

  console.log('\n📦 Creating Bubblegum V2 Merkle tree...');
  console.log('Proposed tree address:', merkleTree.publicKey.toString());

  try {
    // 4. Create Bubblegum V2 Merkle tree
    const builder = await createTreeV2(umi, {
      merkleTree,
      maxDepth: 14, // 2^14 = 16,384 cNFTs
      maxBufferSize: 64, // Valid pair with maxDepth 14
      canopyDepth: 8, // Reduces proof size in transactions
      public: false, // Only creator/delegate can mint
    });

    // 5. Send and confirm transaction
    const result = await builder.sendAndConfirm(umi, {
      send: { skipPreflight: false },
      confirm: { commitment: 'confirmed' },
    });

    // 6. Convert transaction signature to Base58
    const transactionSignature = base58.deserialize(result.signature)[0];

    // 7. Output results
    console.log('\n✅ Merkle tree created successfully!');
    console.log('Tree Address:', merkleTree.publicKey.toString());
    console.log('Transaction:', transactionSignature);
    console.log('Explorer:', `https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`);

    console.log('\n📝 Add to .env:');
    console.log(`SOLANA_MERKLE_TREE_ADDRESS="${merkleTree.publicKey.toString()}"`);
    console.log(`SOLANA_AUTHORITY_SECRET_KEY='${JSON.stringify(Array.from(secretKey))}'`);
  } catch (error) {
    console.error('\n❌ Failed to create Merkle tree');

    if (error instanceof Error) {
      // Check for common errors
      if (error.message.includes('insufficient funds') || error.message.includes('0x1')) {
        console.error('Error: Insufficient funds. Fund your wallet at https://faucet.solana.com');
        console.error('Your wallet address:', publicKey);
      } else {
        console.error('Error:', error.message);
      }
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Script failed');
  console.error(error);
  process.exitCode = 1;
});
