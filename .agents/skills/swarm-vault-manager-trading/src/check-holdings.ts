/**
 * Check Holdings Script
 *
 * View aggregate token holdings across all swarm members.
 *
 * Usage:
 *   pnpm check-holdings [swarmId] [--members]
 *
 * If swarmId is not provided, lists all swarms you manage.
 * Use --members flag to list individual member details with membership IDs.
 *
 * Environment:
 *   SWARM_VAULT_API_KEY - Your API key (required)
 *   SWARM_VAULT_API_URL - API base URL (optional)
 */

import { SwarmVaultClient, SwarmVaultError } from "@swarmvault/sdk";

function parseArgs() {
  const args = process.argv.slice(2);
  const showMembers = args.includes("--members");
  const filteredArgs = args.filter((a) => a !== "--members");
  const swarmId = filteredArgs[0];
  return { swarmId, showMembers };
}

async function main() {
  const apiKey = process.env.SWARM_VAULT_API_KEY;
  const apiUrl = process.env.SWARM_VAULT_API_URL;

  if (!apiKey) {
    console.error("Error: SWARM_VAULT_API_KEY environment variable is required");
    console.error("Get your API key from https://swarmvault.xyz/settings");
    process.exit(1);
  }

  const client = new SwarmVaultClient({
    apiKey,
    baseUrl: apiUrl,
  });

  const { swarmId, showMembers } = parseArgs();

  try {
    if (!swarmId) {
      // List all swarms the user manages
      console.log("Fetching your swarms...\n");
      const swarms = await client.listSwarms();
      const managedSwarms = swarms.filter((s) => s.isManager);

      if (managedSwarms.length === 0) {
        console.log("You don't manage any swarms yet.");
        console.log("Create a swarm at https://swarmvault.xyz");
        return;
      }

      console.log(`You manage ${managedSwarms.length} swarm(s):\n`);

      for (const swarm of managedSwarms) {
        console.log(`Swarm: ${swarm.name}`);
        console.log(`  ID: ${swarm.id}`);
        console.log(`  Members: ${swarm.memberCount || 0}`);
        console.log(`  Description: ${swarm.description || "(none)"}`);

        // Fetch holdings for each swarm
        try {
          const holdings = await client.getSwarmHoldings(swarm.id);
          console.log(`  ETH Balance: ${formatWei(holdings.ethBalance)} ETH`);
          if (holdings.tokens.length > 0) {
            console.log(`  Tokens:`);
            for (const token of holdings.tokens) {
              console.log(
                `    - ${token.symbol}: ${formatUnits(token.totalBalance, token.decimals)} (${token.holderCount} holders)`
              );
            }
          }
        } catch {
          console.log(`  Holdings: Unable to fetch`);
        }
        console.log("");
      }
    } else {
      // Get holdings for specific swarm
      console.log(`Fetching holdings for swarm ${swarmId}...\n`);

      const swarm = await client.getSwarm(swarmId);
      const holdings = await client.getSwarmHoldings(swarmId, { includeMembers: showMembers });

      console.log(`Swarm: ${swarm.name}`);
      console.log(`Members: ${holdings.memberCount}`);
      console.log("");
      console.log("Aggregate Holdings:");
      console.log(`  ETH: ${formatWei(holdings.ethBalance)} ETH`);

      if (holdings.tokens.length > 0) {
        console.log("");
        console.log("  Tokens:");
        for (const token of holdings.tokens) {
          console.log(
            `    ${token.symbol}: ${formatUnits(token.totalBalance, token.decimals)}`
          );
          console.log(`      Address: ${token.address}`);
          console.log(`      Holders: ${token.holderCount}`);
        }
      } else {
        console.log("\n  No ERC20 tokens held");
      }

      // Show individual member balances if --members flag is passed
      if (showMembers && holdings.members) {
        console.log("\n--- Per-Member Balances ---");
        console.log(`\nTotal: ${holdings.members.length} members\n`);
        for (const member of holdings.members) {
          console.log(`Membership ID: ${member.membershipId}`);
          console.log(`  Agent Wallet: ${member.agentWalletAddress}`);
          console.log(`  User Wallet: ${member.userWalletAddress}`);
          console.log(`  ETH Balance: ${formatWei(member.ethBalance)} ETH`);
          if (member.tokens.length > 0) {
            console.log(`  Tokens:`);
            for (const token of member.tokens) {
              console.log(`    - ${token.symbol}: ${formatUnits(token.balance, token.decimals)}`);
            }
          } else {
            console.log(`  Tokens: None`);
          }
          console.log("");
        }
      }

      // Output as JSON for programmatic use
      console.log("\n--- JSON Output ---");
      console.log(JSON.stringify(holdings, null, 2));
    }
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

function formatWei(wei: string): string {
  const value = BigInt(wei);
  const decimals = 18;
  const divisor = BigInt(10 ** decimals);
  const intPart = value / divisor;
  const fracPart = value % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0").slice(0, 6);
  return `${intPart}.${fracStr}`;
}

function formatUnits(value: string, decimals: number): string {
  const bigValue = BigInt(value);
  const divisor = BigInt(10 ** decimals);
  const intPart = bigValue / divisor;
  const fracPart = bigValue % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0").slice(0, 6);
  return `${intPart}.${fracStr}`;
}

main();
