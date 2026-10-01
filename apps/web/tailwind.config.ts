import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f3ecdf",
        paper: "#16130e",
        panel: "#221e17",
        muted: "#a89880",
        line: "#3d3428",
        accent: "#e2a23b",
        good: "#8fbf7f",
        bad: "#d46a6a",
      },
      fontFamily: {
        serif: ["Georgia", "Iowan Old Style", "Palatino", "serif"],
        mono: ["ui-monospace", "Cascadia Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
