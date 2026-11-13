// Reconstruire le CSS après avoir ajouté de nouvelles classes Tailwind :
//   npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind-input.css -o tailwind.css --minify
module.exports = {
  content: ['./index.html', './user.html', './chef.html', './admin.html', './config.js'],
  theme: { extend: {} },
  plugins: [],
};
