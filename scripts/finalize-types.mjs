import { copyFile, mkdir, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const typesDirectory = new URL("dist/types/", root);

await mkdir(typesDirectory, { recursive: true });
await copyFile(
	new URL("src/global.d.ts", root),
	new URL("dist/types/global.d.ts", root)
);
await rm(new URL("dist/temp/", root), { recursive: true, force: true });
