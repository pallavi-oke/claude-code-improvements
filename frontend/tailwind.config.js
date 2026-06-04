/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1020",
        panel: "#11182e",
        panel2: "#161f3a",
        edge: "#243150",
        accent: "#7c9bff",
        good: "#22c55e",
        warn: "#f59e0b",
        bad: "#ef4444",
        muted: "#8aa0c8",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
