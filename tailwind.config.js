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
    container: {
      center: true,
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1536px",
      },
      // container 자체는 반응형이지만, 2xl 이상 화면에선 아래 유틸로 1920 고정
    },
  },
  plugins: [],
}
