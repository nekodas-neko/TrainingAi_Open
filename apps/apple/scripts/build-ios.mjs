import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const { expo } = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
const buildsUrl = `https://expo.dev/accounts/${encodeURIComponent(expo.owner)}/projects/${encodeURIComponent(expo.slug)}/builds`;
const interactive = process.argv.includes("--interactive");
const command =
  "npx.cmd --yes eas-cli@latest build --platform ios --profile development --wait" +
  (interactive ? "" : " --non-interactive --freeze-credentials");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function build() {
  console.log(
    "Building the iPhone development app. This can take several minutes.",
  );
  console.log(
    interactive
      ? "Expo and Apple setup prompts are enabled."
      : "Using saved signing credentials without setup prompts.",
  );
  console.log(`Bookmark this page on your iPhone: ${buildsUrl}`);
  const result = await run("cmd.exe", ["/d", "/c", command], {
    env: { ...process.env, EAS_NO_VCS: "1", EAS_PROJECT_ROOT: root },
  });
  if (result !== 0) {
    process.exitCode = result;
    return;
  }

  console.log(`Build finished. On your iPhone, open ${buildsUrl}`);
  console.log(
    "Choose the latest finished iOS development build, then Install. No QR scan is needed.",
  );
  const browser = spawn(
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", buildsUrl],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  browser.on("error", () =>
    console.log("Open the builds page using the link above."),
  );
  browser.unref();

  try {
    const development = await run(
      process.execPath,
      [resolve(root, "scripts/dev.mjs"), "start"],
      { windowsHide: true },
    );
    if (development !== 0) {
      console.log(
        "The build is ready, but the development server needs attention. Use Start Development.cmd.",
      );
    }
  } catch (error) {
    console.log(
      `The build is ready, but the development server could not start: ${error.message}`,
    );
  }
}

if (process.argv.includes("--check")) {
  console.log(
    JSON.stringify(
      { root, command, buildsUrl, startDevelopmentAfterBuild: true },
      null,
      2,
    ),
  );
} else {
  build().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
