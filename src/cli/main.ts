#!/usr/bin/env node
import { runInteractiveSession } from "./interactive.js";

const args = process.argv.slice(2);

if (args.length > 0) {
  console.error("Ritual MVP has one interactive command and no subcommands or flags.");
  process.exitCode = 1;
} else {
  try {
    const result = await runInteractiveSession();
    if (result.status === "cancelled") {
      console.log(`Ritual stopped: ${result.reason}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error(`Ritual failed: ${message}`);
    process.exitCode = 1;
  }
}
