/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          900: '#070a13',
          800: '#0d1322',
          700: '#141d33',
          600: '#1e2942',
          accent: '#00f0ff',
          neonGreen: '#00ff88',
          neonAmber: '#ffaa00',
          neonRed: '#ff3366',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
      }
    },
  },
  plugins: [],
}
