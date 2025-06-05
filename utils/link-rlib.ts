import { $ } from "bun";
import { join } from "path";

if (process.platform === "win32") {
  await $`cmd /c "mklink /J  ${join(
    process.cwd(),
    "node_modules",
    "rlib"
  )} ${join(process.cwd(), "..", "rlib")}"`;
} else {
  await $`rm -rf node_modules/rlib`;
  await $`ln -s  ${join(process.cwd(), "..", "rlib")} ${join(
    process.cwd(),
    "node_modules",
    "rlib"
  )}`;
}
