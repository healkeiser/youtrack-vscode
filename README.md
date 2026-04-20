# youtrack-vscode

VS Code extension for YouTrack Cloud by Valentin Beaumont.

## Features
- Sidebar with saved searches and issues
- Issue detail webview with native time tracking
- Agile board with drag-and-drop
- Branch from issue with configurable template
- Command palette for create, search, go-to-ID, assign, transition, log time

## Install
Download the latest `.vsix` from Releases, then:

    code --install-extension youtrack-vscode-<version>.vsix

## Configure
On first run you are prompted for your YouTrack Cloud base URL and a permanent token (Profile -> Account Security -> New token).

See settings under "YouTrack" for branch template and cache tuning.

## Develop
    npm install
    npm run build
    npm test
    npm run package
