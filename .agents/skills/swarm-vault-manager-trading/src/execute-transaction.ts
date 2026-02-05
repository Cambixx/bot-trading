/**
 * Execute Transaction Script
 *
 * Execute a raw transaction template across all swarm member wallets.
 *
 * Usage:
 *   pnpm execute-transaction <swarmId> <templateJsonFile>
 *   pnpm execute-transaction <swarmId> --inline '<json>'
 *
 * Arguments:
 *   swarmId           - The swarm ID (UUID)
 *   templateJsonFile  - Path to JSON file containing the transaction template
 *   --inline '<json>' - Inline JSON template (alternative to file)
 *
 * Template Structure (ABI mode):
 *   {
 *     "mode": "abi",
 *     "contractAddress": "0x...",
 *     "abi": [{ "name": "function", "type": "function", ... }],
 *     "functionName": "functionName",
 *     "args": ["arg1", "{{placeholder}}", ...],
 *     "value": "0"
 *   }
 *
 * Template Structure (Raw mode):
 *   {
 *     "mode": "raw",
 *     "contractAddress": "0x...",
 *     "data": "0x...",
 *     "value": "0"
 *   }
 *
 * Environment:
 *   SWARM_VAULT_API_KEY - Your API key (required)
 *   SWARM_VAULT_API_URL - API base URL (optional)
 */

import { readFileSync } from "fs";
import { SwarmVaultClient, SwarmVaultError, TransactionTemplate } from "@swarmvault/sdk";

async function main() {
  const apiKey = process.env.SWARM_VAULT_API_KEY;
  const apiUrl = process.env.SWARM_VAULT_API_URL;

  if (!apiKey) {
    console.error("Error: SWARM_VAULT_API_KEY environment variable is required");
    console.error("Get your API key from https://swarmvault.xyz/settings");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const swarmId = args[0];

  if (!swarmId || args.length < 2) {
    console.error("Usage: pnpm execute-transaction <swarmId> <templateJsonFile>");
    console.error("   or: pnpm execute-transaction <swarmId> --inline '<json>'");
    console.error("");
    console.error("Example:");
    console.error("  pnpm execute-transaction abc-123 ./transfer-template.json");
    console.error('  pnpm execute-transaction abc-123 --inline \'{"mode":"abi",...}\'');
    process.exit(1);
  }

  let template: TransactionTemplate;

  if (args[1] === "--inline") {
    if (!args[2]) {
      console.error("Error: --inline requires a JSON string argument");
      process.exit(1);
    }
    try {
      template = JSON.parse(args[2]);
    } catch (e) {
      console.error("Error: Invalid JSON in --inline argument");
      console.error(e);
      process.exit(1);
    }
  } else {
    const templatePath = args[1];
    try {
      const content = readFileSync(templatePath, "utf-8");
      template = JSON.parse(content);
    } catch (e) {
      console.error(`Error: Could not read template file: ${templatePath}`);
      console.error(e);
      process.exit(1);
    }
  }

  // Validate template structure
  if (!template.mode || !["abi", "raw"].includes(template.mode)) {
    console.error('Error: Template must have "mode" set to "abi" or "raw"');
    process.exit(1);
  }

  if (!template.contractAddress) {
    console.error("Error: Template must have contractAddress");
    process.exit(1);
  }

  const client = new SwarmVaultClient({
    apiKey,
    baseUrl: apiUrl,
  });

  try {
    console.log("Execute Transaction");
    console.log("===================");
    console.log(`Swarm: ${swarmId}`);
    console.log(`Mode: ${template.mode}`);
    console.log(`Contract: ${template.contractAddress}`);
    if (template.mode === "abi") {
      console.log(`Function: ${template.functionName}`);
      console.log(`Args: ${JSON.stringify(template.args)}`);
    } else {
      console.log(`Data: ${template.data.slice(0, 66)}...`);
    }
    console.log(`Value: ${template.value}`);
    console.log("");
    console.log("Executing transaction...\n");

    const result = await client.executeTransaction(swarmId, template);

    console.log("Transaction Initiated!");
    console.log(`Transaction ID: ${result.transactionId}`);
    console.log(`Status: ${result.status}`);
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

      if (confirmed > 0) {
        console.log("\nConfirmed transactions:");
        for (const target of tx.targets.filter((t) => t.status === "CONFIRMED")) {
          console.log(
            `  ${target.membership?.agentWalletAddress || target.membershipId}: ${target.txHash || "N/A"}`
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
