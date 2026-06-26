import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceDirectory = path.join(projectDirectory, "web", "public");
const adminSourceDirectory = path.join(projectDirectory, "admin", "public");
const outputDirectory = path.join(projectDirectory, "public");
const adminOutputDirectory = path.join(outputDirectory, "admin");

await rm(outputDirectory, { recursive: true, force: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });
await cp(adminSourceDirectory, adminOutputDirectory, { recursive: true });
