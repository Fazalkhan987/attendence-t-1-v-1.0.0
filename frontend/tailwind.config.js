/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Public Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      colors: {
        ink: { DEFAULT: '#142340', 700: '#1c2f52', 600: '#26406b', 300: '#a9b6cf' },
        paper: '#f6f8f9',
        line: '#dfe5ea',
        muted: '#5f6b7a',
        brand: { DEFAULT: '#2b59c3', 600: '#2249a6', 50: '#eef3fc', 100: '#dce6f8' },
        present: { DEFAULT: '#1e8a57', 50: '#e9f6ef' },
        late: { DEFAULT: '#b26f12', 50: '#fbf3e4' },
        danger: { DEFAULT: '#c2413b', 50: '#fbeceb' },
      },
      boxShadow: {
        panel: '0 1px 2px rgba(20,35,64,0.06), 0 0 0 1px rgba(20,35,64,0.06)',
        pop: '0 12px 32px -8px rgba(20,35,64,0.28)',
      },
    },
  },
  plugins: [],
}
