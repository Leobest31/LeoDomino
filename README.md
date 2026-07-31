# LeoDomino

Professional offline-first domino game built with React and Vite.

## Stack

- React 19
- Vite
- JavaScript
- CSS (no UI framework)

## Scripts

```bash
npm install
npm run dev
npm run build
npm run preview
npm test              # engine + rules + ai + i18n + UI copy scan
npm run test:engine
npm run test:rules
npm run test:ai
npm run test:i18n
npm run test:i18n:ui
```

## Structure

```
src/
  assets/       Static media
  components/   UI building blocks
  pages/        Full-screen views
  styles/       Global CSS tokens & reset
  hooks/        Shared React hooks (future)
  utils/        Pure helpers
  game/         Game engine modules
  data/         Static / display data
  i18n/         Internationalization (ht, en, fr, es, pt)
```

## Internationalization

- Default language: **Haitian Creole (`ht`)**
- Also: English, French, Spanish, Portuguese
- All UI copy lives in `src/i18n/locales/*.js`
- Use `const { t } = useI18n()` — never hardcode user-facing text in components
- Language preference is saved in `localStorage` (`leodomino.locale`)
- Add a language: new locale file → register in `locales/index.js` + `config.js`

```bash
npm run test:i18n
```
