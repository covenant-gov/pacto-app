## Install

### macOS

**Homebrew**

```bash
brew tap covenant-gov/pacto
brew install --cask pacto
```

Pacto is currently unsigned. After installing, remove the quarantine attribute:

```bash
xattr -r -d com.apple.quarantine /Applications/Pacto.app
```

Then launch Pacto from Applications.

**Manual install**

Download the DMG for your Mac and drag `Pacto.app` to Applications:
- Apple Silicon (M1/M2/M3): `pacto_{{VERSION}}_aarch64.dmg`
- Intel: `pacto_{{VERSION}}_x64.dmg`

Then run the `xattr` command above.

### Linux

**Debian / Ubuntu (AMD64)**

```bash
curl -LO https://github.com/covenant-gov/pacto-app/releases/download/{{TAG}}/pacto_{{VERSION}}_amd64.deb
sudo dpkg -i pacto_{{VERSION}}_amd64.deb
```

**Fedora / RHEL / openSUSE (x86_64)**

```bash
curl -LO https://github.com/covenant-gov/pacto-app/releases/download/{{TAG}}/pacto-{{VERSION}}-1.x86_64.rpm
sudo dnf install ./pacto-{{VERSION}}-1.x86_64.rpm
```

**AppImage**

```bash
curl -LO https://github.com/covenant-gov/pacto-app/releases/download/{{TAG}}/pacto_{{VERSION}}_amd64.AppImage
chmod +x pacto_{{VERSION}}_amd64.AppImage
./pacto_{{VERSION}}_amd64.AppImage
```

### Windows

Download `pacto_{{VERSION}}_x64_en-US.msi` and run it. Windows Defender SmartScreen may warn that the app is unsigned; click **More info** → **Run anyway**.
