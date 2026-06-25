import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runIngestion } from "../src/pipeline/pdf-ingestion.mjs";

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const defaultInput = path.resolve(
  projectDirectory,
  "..",
  "belajar-scraping",
  "pdf_books_c0",
);
const defaultOutput = path.resolve(projectDirectory, "data", "processed");

const inputDirectory = path.resolve(readArgument("--input", defaultInput));
const outputDirectory = path.resolve(readArgument("--output", defaultOutput));
const limitValue = Number(readArgument("--limit", "0"));
const readingSpeed = Number(readArgument("--reading-speed", "200"));

console.log(`Input  : ${inputDirectory}`);
console.log(`Output : ${outputDirectory}`);
console.log(`Limit  : ${limitValue > 0 ? limitValue : "semua file"}`);

const { report } = await runIngestion({
  inputDirectory,
  outputDirectory,
  limit: limitValue > 0 ? limitValue : undefined,
  readingSpeed,
});

console.log("");
console.log("Pipeline selesai.");
console.log(`Diproses          : ${report.processed}`);
console.log(`Gagal             : ${report.failed}`);
console.log(`Siap direview     : ${report.ready_for_review}`);
console.log(`Perlu pemeriksaan : ${report.needs_review}`);
console.log(`Laporan           : ${path.join(outputDirectory, "_ingestion-report.json")}`);
