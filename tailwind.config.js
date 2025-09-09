/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },   // 중간에 살짝 흐려짐
        },
      },
      animation: {
        blink: 'blink 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
