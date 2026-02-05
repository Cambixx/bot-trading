/**
 * Execute Swap Script
 *
 * Execute a swap across swarm member wallets.
 *
 * Usage:
 *   pnpm execute-swap <swarmId> <sellToken> <buyToken> [sellPercentage] [slippagePercentage] [--members id1,id2,...]
 *
 * Arguments:
 *   swarmId           - The swarm ID (UUID)
 *   sellToken         - Token address or symbol (ETH, WETH, USDC, DAI, USDbC, cbETH)
 *   buyToken          - Token address or symbol
 *   sellPercentage    - Percentage to sell (1-100, default: 100)
 *   slippagePercentage - Slippage tolerance (default: 1)
 *   --members         - Optional comma-separated list of membership IDs to include
 *
 * Environment:
 *   SWARM_VAULT_API_KEY - Your API key (required)
 *   SWARM_VAULT_API_URL - API base URL (optional)
 */

import {
  SwarmVaultClient,
  SwarmVaultError,
  BASE_MAINNET_TOKENS,
  NATIVE_ETH_ADDRESS,
} from "@swarmvault/sdk";

// Token symbol to address mapping
const TOKEN_MAP: Record<string, string> = {
  ETH: NATIVE_ETH_ADDRESS,
  WETH: BASE_MAINNET_TOKENS.WETH,
  USDC: BASE_MAINNET_TOKENS.USDC,
  DAI: BASE_MAINNET_TOKENS.DAI,
  USDC_BRIDGED: BASE_MAINNET_TOKENS.USDbC,
  USDBC: BASE_MAINNET_TOKENS.USDbC,
  CBETH: BASE_MAINNET_TOKENS.cbETH,
};

function resolveToken(input: string): string {
  const upper = input.toUpperCase();
  if (TOKEN_MAP[upper]) {
    return TOKEN_MAP[upper];
  }
  if (input.startsWith("0x") && input.length === 42) {
    return input;
  }
  throw new Error(
    `Unknown token: ${input}. Use an address or symbol (ETH, WETH, USDC, DAI, USDbC, cbETH)`
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  let membershipIds: string[] | undefined;

  // Extract --members flag
  const membersIndex = args.findIndex((a) => a === "--members");
  if (membersIndex !== -1 && args[membersIndex + 1]) {
    membershipIds = args[membersIndex + 1].split(",").map((id) => id.trim());
    args.splice(membersIndex, 2);
  }

  const [swarmId, sellTokenInput, buyTokenInput, sellPctStr, slippageStr] = args;
  return { swarmId, sellTokenInput, buyTokenInput, sellPctStr, slippageStr, membershipIds };
}

async function main() {
  const apiKey = process.env.SWARM_VAULT_API_KEY;
  const apiUrl = process.env.SWARM_VAULT_API_URL;

  if (!apiKey) {
    console.error("Error: SWARM_VAULT_API_KEY environment variable is required");
    console.error("Get your API key from https://swarmvault.xyz/settings");
    process.exit(1);
  }

  const { swarmId, sellTokenInput, buyTokenInput, sellPctStr, slippageStr, membershipIds } = parseArgs();

  if (!swarmId || !sellTokenInput || !buyTokenInput) {
    console.error(
      "Usage: pnpm execute-swap <swarmId> <sellToken> <buyToken> [sellPercentage] [slippagePercentage] [--members id1,id2,...]"
    );
    console.error("");
    console.error("Example: pnpm execute-swap abc-123 USDC WETH 50 1");
    console.error("Example: pnpm execute-swap abc-123 USDC WETH 50 1 --members member-id-1,member-id-2");
    console.error("");
    console.error("Token symbols: ETH, WETH, USDC, DAI, USDbC, cbETH");
    console.error("Or use full token addresses (0x...)");
    process.exit(1);
  }

  const sellToken = resolveToken(sellTokenInput);
  const buyToken = resolveToken(buyTokenInput);
  const sellPercentage = sellPctStr ? parseInt(sellPctStr, 10) : 100;
  const slippagePercentage = slippageStr ? parseFloat(slippageStr) : 1;

  if (sellPercentage < 1 || sellPercentage > 100) {
    console.error("Error: sellPercentage must be between 1 and 100");
    process.exit(1);
  }

  const client = new SwarmVaultClient({
    apiKey,
    baseUrl: apiUrl,
  });

  try {
    console.log("Execute Swap");
    console.log("============");
    console.log(`Swarm: ${swarmId}`);
    console.log(`Sell: ${sellTokenInput} (${sellToken})`);
    console.log(`Buy: ${buyTokenInput} (${buyToken})`);
    console.log(`Sell Percentage: ${sellPercentage}%`);
    console.log(`Slippage: ${slippagePercentage}%`);
    if (membershipIds) {
      console.log(`Members: ${membershipIds.length} specified`);
    } else {
      console.log(`Members: All active members`);
    }
    console.log("");
    console.log("Executing swap...\n");

    const result = await client.executeSwap(swarmId, {
      sellToken,
      buyToken,
      sellPercentage,
      slippagePercentage,
      membershipIds,
    });

    console.log("Swap Initiated!");
    console.log(`Transaction ID: ${result.transactionId}`);
    console.log(`Status: ${result.status}`);
    console.log(`Members: ${result.memberCount}`);
    console.log(`Message: ${result.message}`);

    if (result.fee) {
      console.log(`Platform Fee: ${result.fee.percentage}`);
    }

    console.log("");
    console.log("Waiting for completion...\n");

    const tx = await client.waitForTransaction(result.transactionId, {
      onPoll: (transaction) => {
        const confirmed =
          transaction.targets?.filter((t) => t.status === "CONFIRMED").length ?? 0;
        const failed =
          transaction.targets?.filter((t) => t.status === "FAILED").length ?? 0;
        const total = transaction.targets?.length ?? 0;
        console.log(
          `  Status: ${transaction.status} | Confirmed: ${confirmed}/${total} | Failed: ${failed}`
        );
      },
    });

    console.log("");
    console.log("=".repeat(50));
    console.log(`Final Status: ${tx.status}`);
    console.log("=".repeat(50));

    if (tx.targets) {
      const confirmed = tx.targets.filter((t) => t.status === "CONFIRMED").length;
      const failed = tx.targets.filter((t) => t.status === "FAILED").length;

      console.log(`\nResults: ${confirmed} confirmed, ${failed} failed`);

      if (failed > 0) {
        console.log("\nFailed transactions:");
        for (const target of tx.targets.filter((t) => t.status === "FAILED")) {
          console.log(
            `  ${target.membership?.agentWalletAddress || target.membershipId}: ${target.error}`
          );
        }
      }
    }

    console.log("\n--- JSON Output ---");
    console.log(JSON.stringify(tx, null, 2));
  } catch (error) {
    if (error instanceof SwarmVaultError) {
      console.error(`Error [${error.errorCode || "UNKNOWN"}]: ${error.message}`);
      if (error.details) {
        console.error("Details:", JSON.stringify(error.details, null, 2));
      }
    } else {
      console.error("Error:", error);
    }
    process.exit(1);
  }
}

main();
