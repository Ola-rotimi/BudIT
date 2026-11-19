# Releasing BudIT

A checklist for every store build. Run the commands from the project root.

## 1. Check the code

```sh
npm run check   # typecheck, lint and expo-doctor
npm run audit   # known vulnerabilities in app dependencies (high and above)
```

Fix anything `check` reports before building. For `audit`, look at where each advisory comes from:
issues in build-time tools (for example `minimatch` or `picomatch`, used by Metro and Babel) don't
ship inside the app. Don't run `npm audit fix --force`: it can install versions that don't match
the Expo SDK. Use `npx expo install --fix` instead, and wait for an SDK patch release when needed.

## 2. Keys live in Expo, not in files

The RevenueCat SDK keys are read from `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and
`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`. Locally they come from `.env` (never committed). For cloud
builds, store them as Expo environment variables so no build depends on someone's laptop:

```sh
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_REVENUECAT_IOS_KEY --value appl_... --visibility sensitive
npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_REVENUECAT_ANDROID_KEY --value goog_... --visibility sensitive
```

Repeat with `--environment preview` and `--environment development`. Each build profile in
`eas.json` names its environment, so `eas build --profile production` picks up the production keys.
To work locally with the same values: `npx eas-cli@latest env:pull --environment development`.

`EXPO_PUBLIC_` values are compiled into the app, which is fine for these *public* SDK keys. Never
give a secret key (RevenueCat secret API key, signing keys) an `EXPO_PUBLIC_` name.

## 3. Build

```sh
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --profile production --platform all
```

Use `--profile development` for a development build: it's needed to test the home-screen widget,
Face ID / fingerprint unlock and database encryption, which Expo Go can't run.

## 4. Over-the-air updates and code signing (not set up yet)

BudIT doesn't use over-the-air updates today: every change ships as a store build, so there's no
update channel that could be tampered with. If OTA updates are added later (`expo-updates` +
`eas update`), turn on end-to-end code signing at the same time, so the app only runs updates
signed with your own private key:

```sh
npx expo-updates codesigning:generate --key-output-directory keys --certificate-output-directory certs --certificate-validity-duration-years 10 --certificate-common-name "BudIT"
npx expo-updates codesigning:configure --certificate-input-directory certs --key-input-directory keys
npx eas-cli@latest update --private-key-path keys/private-key.pem
```

- `keys/` is git-ignored. Keep the private key in a password manager; if it's lost, signed updates
  can't be published to existing installs.
- Commit `certs/certificate.pem` and make a new store build so it's embedded in the app.
- Expo Update code signing needs an Expo Production or Enterprise plan.

## 5. Before submitting

- Version and build number bumped (`autoIncrement` handles the build number).
- Privacy policy (`docs/privacy-policy.html`) still matches what the app does.
- The 7-day free trial is set on both subscriptions in App Store Connect and Google Play.
- Test a restore from a backup made by the previous version.
