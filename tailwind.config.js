/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        graphite: {
          950: '#101316',
          900: '#15181C',
          800: '#1C2024',
          700: '#262B30',
          600: '#343A40',
          500: '#4A5158',
        },
        ink: {
          100: '#EEF0F2',
          300: '#C3C9CE',
          500: '#8B939B',
        },
        amber: {
          400: '#F2A93B',
          500: '#E0961F',
        },
        teal: {
          400: '#3FA796',
          500: '#2E8B7C',
        },
        rust: {
          400: '#E5644B',
          500: '#D14C33',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
