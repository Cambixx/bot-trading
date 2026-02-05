/**
 * Check Transaction Script
 *
 * Monitor a transaction's status.
 *
 * Usage:
 *   pnpm check-transaction <transactionId> [--wait]
 *
 * Arguments:
 *   transactionId - The transaction ID (UUID)
 *   --wait        - Poll until transaction completes (optional)
 *
 * Environment:
 *   SWARM_VAULT_API_KEY - Your API key (required)
 *   SWARM_VAULT_API_URL - API base URL (optional)
 */

import { SwarmVaultClient, SwarmVaultError } from "@swarmvault/sdk";

async function main() {
  const apiKey = process.env.SWARM_VAULT_API_KEY;
  const apiUrl = process.env.SWARM_VAULT_API_URL;

  if (!apiKey) {
    console.error("Error: SWARM_VAULT_API_KEY environment variable is required");
    console.error("Get your API key from https://swarmvault.xyz/settings");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const transactionId = args[0];
  const shouldWait = args.includes("--wait");

  if (!transactionId) {
    console.error("Usage: pnpm check-transaction <transactionId> [--wait]");
    console.error("");
    console.error("Options:");
    console.error("  --wait    Poll until transaction completes");
    console.error("");
    console.error("Example: pnpm check-transaction abc-123-def-456 --wait");
    process.exit(1);
  }

  const client = new SwarmVaultClient({
    apiKey,
    baseUrl: apiUrl,
  });

  try {
    console.log("Check Transaction");
    console.log("=================");
    console.log(`Transaction ID: ${transactionId}`);
    console.log(`Wait for completion: ${shouldWait ? "Yes" : "No"}`);
    console.log("");

    let tx;

    if (shouldWait) {
      console.log("Waiting for completion...\n");
      tx = await client.waitForTransaction(transactionId, {
        onPoll: (transaction) => {
          const confirmed =
            transaction.targets?.filter((t) => t.status === "CONFIRMED").length ?? 0;
          const failed =
            transaction.targets?.filter((t) => t.status === "FAILED").length ?? 0;
          const pending =
            transaction.targets?.filter(
              (t) => t.status === "PENDING" || t.status === "SUBMITTED"
            ).length ?? 0;
          const total = transaction.targets?.length ?? 0;
          console.log(
            `  Status: ${transaction.status} | Confirmed: ${confirmed} | Failed: ${failed} | Pending: ${pending} | Total: ${total}`
          );
        },
      });
      console.log("");
    } else {
      tx = await client.getTransaction(transactionId);
    }

    console.log("=".repeat(50));
    console.log(`Status: ${tx.status}`);
    console.log(`Created: ${tx.createdAt}`);
    console.log(`Updated: ${tx.updatedAt}`);
    console.log("=".repeat(50));

    if (tx.targets && tx.targets.length > 0) {
      const confirmed = tx.targets.filter((t) => t.status === "CONFIRMED").length;
      const failed = tx.targets.filter((t) => t.status === "FAILED").length;
      const pending = tx.targets.filter(
        (t) => t.status === "PENDING" || t.status === "SUBMITTED"
      ).length;

      console.log(
        `\nTargets: ${tx.targets.length} total | ${confirmed} confirmed | ${failed} failed | ${pending} pending`
      );
      console.log("");

      for (const target of tx.targets) {
        const wallet = target.membership?.agentWalletAddress || target.membershipId;
        const statusEmoji =
          target.status === "CONFIRMED"
            ? "✓"
            : target.status === "FAILED"
              ? "✗"
              : "○";

        console.log(`  ${statusEmoji} ${truncateAddress(wallet)}: ${target.status}`);

        if (target.txHash) {
          console.log(`      TX: ${target.txHash}`);
        }
        if (target.userOpHash) {
          console.log(`      UserOp: ${target.userOpHash}`);
        }
        if (target.error) {
          console.log(`      Error: ${target.error}`);
        }
      }
    }

    // Show template info if available
    if (tx.template) {
      console.log("\nTemplate:");
      console.log(`  Mode: ${tx.template.mode}`);
      console.log(`  Contract: ${tx.template.contractAddress}`);
      if (tx.template.mode === "abi") {
        console.log(`  Function: ${tx.template.functionName}`);
      }
    }

    console.log("\n--- JSON Output ---");
    console.log(JSON.stringify(tx, null, 2));

    // Exit with error code if transaction failed
    if (tx.status === "FAILED") {
      process.exit(1);
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

function truncateAddress(address: string): string {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

main();
