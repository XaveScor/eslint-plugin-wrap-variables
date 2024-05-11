# Installation guide

Paste the following code into your eslint config:
```javascript
module.exports = {
  // for eslint-typescript
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  plugins: [
    '@xavescor/eslint-plugin-wrap-variables',
  ],
  rules: {
    '@xavescor/wrap-variables/useWrap': 'error',
  }
}
```
