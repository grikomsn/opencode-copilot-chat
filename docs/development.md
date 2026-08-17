# Development

```sh
npm ci
npm run check
npm run package
```

The extension host is the right place to test authenticated inference. Unit tests use injected fetchers and fake Secret Storage; they never contact OpenCode with real credentials.
