import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  importCatalog,
  loadCatalog,
  validateCatalog,
} from "../src/importer/catalog-importer.mjs";

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const catalogPath = path.resolve(
  readArgument(
    "--catalog",
    path.join(projectDirectory, "data", "processed", "full", "_catalog.json"),
  ),
);
const dryRun = process.argv.includes("--dry-run");
const databaseUrl = readArgument("--database-url", process.env.DATABASE_URL);

console.log(`Catalog : ${catalogPath}`);
console.log(`Mode    : ${dryRun ? "validasi" : "import PostgreSQL"}`);

const catalog = await loadCatalog(catalogPath);
const validation = validateCatalog(catalog);

console.log(`Buku              : ${validation.totalBooks}`);
console.log(`Siap direview     : ${validation.readyForReview}`);
console.log(`Perlu pemeriksaan : ${validation.needsReview}`);
console.log(`Warning           : ${validation.warnings.length}`);
console.log(`Error             : ${validation.errors.length}`);

if (!validation.valid) {
  console.error(validation.errors.slice(0, 20).join("\n"));
  process.exitCode = 1;
} else if (dryRun) {
  console.log("Validasi selesai. Tidak ada data yang ditulis.");
} else if (!databaseUrl) {
  console.error(
    "DATABASE_URL belum tersedia. Gunakan --database-url atau environment DATABASE_URL.",
  );
  process.exitCode = 1;
} else {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await importCatalog(client, catalog, {
      catalogPath,
      sourceDirectory: path.dirname(catalogPath),
      onProgress({ processed, total, book }) {
        if (processed === 1 || processed % 100 === 0 || processed === total) {
          console.log(`[${processed}/${total}] ${book.title}`);
        }
      },
    });
    console.log(`Import selesai. Batch: ${result.batchId}`);
  } finally {
    await client.end();
  }
}
