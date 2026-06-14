/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f2efff',
          100: '#e5defe',
          500: '#663af3',
          600: '#663af3',
          700: '#512bd0'
        }
      }
    }
  },
  plugins: []
};
