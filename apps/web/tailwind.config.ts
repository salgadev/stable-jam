import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Per docs/05-accessibility.md §High contrast and theming
        bg: "var(--bg)",
        fg: "var(--fg)",
        accent: "var(--accent)",
        focus: "var(--focus)",
        "limb-kick": "var(--limb-kick)",
        "limb-snare": "var(--limb-snare)",
        "limb-hihat": "var(--limb-hihat)",
        "limb-ride": "var(--limb-ride)",
        "limb-crash": "var(--limb-crash)",
        "limb-china": "var(--limb-china)",
      },
    },
  },
  plugins: [],
};

export default config;
