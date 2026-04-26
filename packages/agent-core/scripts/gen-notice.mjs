import path from "node:path";
import { fileURLToPath } from "node:url";
import { init as initLicenseChecker } from "license-checker-rseidelsohn";
import { generateNotice } from "../../../scripts/generate-notice.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

await generateNotice({
  pkgRoot,
  initLicenseChecker,
});
