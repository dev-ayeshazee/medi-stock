/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7f4',
          100: '#d6ece4',
          500: '#0d9488',
          600: '#0b7d73',
          700: '#0a6c63',
        },
      },
    },
  },
  plugins: [],
};
