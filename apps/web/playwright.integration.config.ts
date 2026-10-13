import { defineConfig } from "@playwright/test";
import instagram from "./playwright.instagram.config";
export default defineConfig({ ...instagram, testMatch: "**/*.spec.ts", testIgnore: ["ai.spec.ts"] });
