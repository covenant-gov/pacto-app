#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEST_DIR = resolve(ROOT, '.local-update-test');
const BACKUP_SUFFIX = '.local-update-test-backup';

const FILES = {
  packageJson: resolve(ROOT, 'package.json'),
  cargoToml: resolve(ROOT, 'src-tauri', 'Cargo.toml'),
  tauriConf: resolve(ROOT, 'src-tauri', 'tauri.conf.json'),
};

const PLATFORM_INFO = detectPlatform();

function detectPlatform() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return {
      id: arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64',
      archLabel: arch === 'arm64' ? 'aarch64' : 'x86_64',
      productName: 'pacto',
      dmgDir: resolve(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'dmg'),
      updaterDir: resolve(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'macos'),
      dmgExtension: '.dmg',
      updaterExtension: '.app.tar.gz',
    };
  }

  if (platform === 'win32') {
    return {
      id: 'windows-x86_64',
      archLabel: 'x64',
      productName: 'pacto',
      bundleDir: resolve(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'msi'),
      extension: '.msi',
    };
  }

  if (platform === 'linux') {
    return {
      id: 'linux-x86_64',
      archLabel: 'amd64',
      productName: 'pacto',
      bundleDir: resolve(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'appimage'),
      extension: '.AppImage',
    };
  }

  throw new Error(`Unsupported platform for local update testing: ${platform}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    oldVersion: '0.3.1',
    newVersion: '0.3.2',
    signingKey: resolve(process.env.HOME || process.env.USERPROFILE, '.tauri', 'pacto.key'),
    signingKeyPassword: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '',
    port: 8080,
    install: false,
    serve: true,
    restore: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--old-version':
        options.oldVersion = args[++i];
        break;
      case '--new-version':
        options.newVersion = args[++i];
        break;
      case '--signing-key':
        options.signingKey = resolve(args[++i]);
        break;
      case '--signing-key-password':
        options.signingKeyPassword = args[++i];
        break;
      case '--port':
        options.port = parseInt(args[++i], 10);
        break;
      case '--install':
        options.install = true;
        break;
      case '--no-serve':
        options.serve = false;
        break;
      case '--restore':
        options.restore = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Usage: node scripts/local-update-test.mjs [options]

Build two release versions of Pacto, generate a local update manifest, and
serve it so you can test the in-app updater end-to-end.

Options:
  --old-version <x.y.z>   Version of the installed app (default: 0.3.1)
  --new-version <x.y.z>   Version of the update (default: 0.3.2)
  --signing-key <path>    Path to Tauri updater private key (default: ~/.tauri/pacto.key)
  --signing-key-password <password>
                         Password for the private key (default: env TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
  --port <number>         Port for the local update server (default: 8080)
  --install               Install the old version to /Applications/Pacto-Test.app
  --no-serve              Build artifacts but do not start the local server
  --restore               Restore backed-up files and exit
  --help, -h              Show this help

Example:
  pnpm exec node scripts/local-update-test.mjs --old-version 0.3.1 --new-version 0.3.2 --install

After the script starts the server, open the installed old app and go to:
  Settings → App → Updates → Check for Updates
`);
}

function backupFiles() {
  for (const file of Object.values(FILES)) {
    const backupPath = `${file}${BACKUP_SUFFIX}`;
    if (!existsSync(backupPath)) {
      copyFileSync(file, backupPath);
    }
  }
}

function restoreFiles() {
  for (const file of Object.values(FILES)) {
    const backupPath = `${file}${BACKUP_SUFFIX}`;
    if (existsSync(backupPath)) {
      copyFileSync(backupPath, file);
      rmSync(backupPath);
    }
  }
}

function setVersion(version) {
  // package.json
  const pkg = JSON.parse(readFileSync(FILES.packageJson, 'utf8'));
  pkg.version = version;
  writeFileSync(FILES.packageJson, JSON.stringify(pkg, null, 2) + '\n');

  // tauri.conf.json
  const tauriConf = JSON.parse(readFileSync(FILES.tauriConf, 'utf8'));
  tauriConf.version = version;
  writeFileSync(FILES.tauriConf, JSON.stringify(tauriConf, null, 2) + '\n');

  // Cargo.toml: version is inside [package]
  const cargoToml = readFileSync(FILES.cargoToml, 'utf8');
  const updatedCargoToml = cargoToml.replace(
    /^(\[package\][\s\S]*?^version = ")[^"]+(")/m,
    `$1${version}$2`
  );
  writeFileSync(FILES.cargoToml, updatedCargoToml);
}

function setLocalEndpoint(port) {
  const tauriConf = JSON.parse(readFileSync(FILES.tauriConf, 'utf8'));
  tauriConf.plugins ??= {};
  tauriConf.plugins.updater ??= {};
  tauriConf.plugins.updater.endpoints = [`http://localhost:${port}/latest.json`];
  writeFileSync(FILES.tauriConf, JSON.stringify(tauriConf, null, 2) + '\n');
}

function ensureSigningKey(path) {
  if (existsSync(path)) {
    return;
  }

  console.log(`Signing key not found at ${path}. Generating a new one...`);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  try {
    execSync(`pnpm exec tauri signer generate -w ${path}`, { stdio: 'inherit' });
  } catch (_err) {
    throw new Error('Failed to generate signing key. You can generate one manually with: pnpm exec tauri signer generate', { cause: _err });
  }

  console.log('');
  console.log('⚠️  A new signing key was generated.');
  console.log('You MUST update src-tauri/tauri.conf.json plugins.updater.pubkey with the public key printed above.');
  console.log('Then re-run this script.');
  process.exit(1);
}

function buildRelease(signingKey, signingKeyPassword, label) {
  console.log(`\nBuilding ${label}...`);
  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: signingKey,
  };
  if (signingKeyPassword) {
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = signingKeyPassword;
  }
  execSync('pnpm tauri:build', {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });
}

function findArtifact(bundleDir, version, extension) {
  const candidates = [
    resolve(bundleDir, `pacto_${version}_${PLATFORM_INFO.archLabel}${extension}`),
    resolve(bundleDir, `Pacto_${version}_${PLATFORM_INFO.archLabel}${extension}`),
    resolve(bundleDir, `pacto_${version}${extension}`),
    resolve(bundleDir, `Pacto_${version}${extension}`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not find built artifact for ${version} in ${bundleDir}. Searched: ${candidates.join(', ')}`);
}

function findOldInstaller(version) {
  if (PLATFORM_INFO.dmgDir) {
    return findArtifact(PLATFORM_INFO.dmgDir, version, PLATFORM_INFO.dmgExtension);
  }
  return findArtifact(PLATFORM_INFO.bundleDir, version, PLATFORM_INFO.extension);
}

function findUpdaterArtifact(version) {
  if (PLATFORM_INFO.updaterDir) {
    return findArtifact(PLATFORM_INFO.updaterDir, version, PLATFORM_INFO.updaterExtension);
  }
  return findArtifact(PLATFORM_INFO.bundleDir, version, PLATFORM_INFO.extension);
}

function findSignature(artifactPath) {
 const sigPath = `${artifactPath}.sig`;
  if (existsSync(sigPath)) {
    return sigPath;
  }
  throw new Error(`Signature file not found: ${sigPath}`);
}

function generateManifest(newVersion, artifactPath, sigPath, port) {
  const filename = basename(artifactPath);
  const signature = readFileSync(sigPath, 'utf8').trim();

  const manifest = {
    version: newVersion,
    notes: 'Local update test',
    pub_date: new Date().toISOString(),
    platforms: {
      [PLATFORM_INFO.id]: {
        signature,
        url: `http://localhost:${port}/${filename}`,
      },
    },
  };

  const manifestPath = resolve(TEST_DIR, 'latest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifestPath;
}

function installTestApp(dmgPath) {
  console.log('\nInstalling test app to /Applications/Pacto-Test.app...');

  // Mount the DMG
  const mountResult = execSync(`hdiutil attach -nobrowse -readonly "${dmgPath}"`, { encoding: 'utf8' });
  const mountLine = mountResult.split('\n').find(line => line.includes('/Volumes/'));
  if (!mountLine) {
    throw new Error('Failed to mount DMG');
  }
  const mountPoint = mountLine.split('\t').pop().trim();

  try {
    // Remove existing test app
    execSync('rm -rf /Applications/Pacto-Test.app', { stdio: 'ignore' });

    // Copy app bundle
    execSync(`cp -R "${mountPoint}/Pacto.app" /Applications/Pacto-Test.app`, { stdio: 'inherit' });

    // Remove quarantine
    execSync('xattr -rd com.apple.quarantine /Applications/Pacto-Test.app', { stdio: 'ignore' });
  } finally {
    // Unmount the DMG
    execSync(`hdiutil detach "${mountPoint}"`, { stdio: 'ignore' });
  }

  console.log('Installed /Applications/Pacto-Test.app');
}

function serveTestDir(port, oldArtifactPath) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url === '/' ? '/index.html' : req.url;
      const filePath = resolve(TEST_DIR, urlPath.slice(1));

      if (!filePath.startsWith(TEST_DIR)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      if (!existsSync(filePath)) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const data = readFileSync(filePath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(data);
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`\nLocal update server running at http://localhost:${port}`);
      console.log(`Manifest: http://localhost:${port}/latest.json`);
      console.log('');
      console.log('Next step:');
      if (existsSync('/Applications/Pacto-Test.app')) {
        console.log('  open /Applications/Pacto-Test.app');
      } else {
        console.log(`  Open ${oldArtifactPath} and drag Pacto.app to /Applications (or re-run with --install).`);
      }
      console.log('  Then in the app: Settings → App → Updates → Check for Updates');
      console.log('  Press Ctrl+C to stop the server and restore files.');
      resolve(server);
    });
  });
}

async function main() {
  const options = parseArgs();

  if (options.restore) {
    console.log('Restoring backed-up files...');
    restoreFiles();
    console.log('Restored.');
    process.exit(0);
  }

  console.log('Local update test setup');
  console.log(`  Old version: ${options.oldVersion}`);
  console.log(`  New version: ${options.newVersion}`);
  console.log(`  Platform: ${PLATFORM_INFO.id}`);
  console.log(`  Signing key: ${options.signingKey}`);
  console.log(`  Signing key password: ${options.signingKeyPassword ? 'provided' : 'not provided'}`);
  console.log(`  Server port: ${options.port}`);
  console.log(`  Install test app: ${options.install}`);

  ensureSigningKey(options.signingKey);

  // Prepare test directory
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });

  // Backup and modify source files
  backupFiles();
  setLocalEndpoint(options.port);

  try {
    // Build old version
    setVersion(options.oldVersion);
    buildRelease(options.signingKey, options.signingKeyPassword, `old version ${options.oldVersion}`);
    const oldArtifact = findOldInstaller(options.oldVersion);
    const oldArtifactDest = resolve(TEST_DIR, basename(oldArtifact));
    copyFileSync(oldArtifact, oldArtifactDest);
    console.log(`\nOld installer: ${oldArtifactDest}`);

    // Build new version
    setVersion(options.newVersion);
    buildRelease(options.signingKey, options.signingKeyPassword, `new version ${options.newVersion}`);
    const newArtifact = findUpdaterArtifact(options.newVersion);
    const newArtifactSig = findSignature(newArtifact);
    const newArtifactDest = resolve(TEST_DIR, basename(newArtifact));
    const newSigDest = resolve(TEST_DIR, basename(newArtifactSig));
    copyFileSync(newArtifact, newArtifactDest);
    copyFileSync(newArtifactSig, newSigDest);
    console.log(`\nNew updater artifact: ${newArtifactDest}`);
    console.log(`Signature: ${newSigDest}`);

    // Generate manifest
    const manifestPath = generateManifest(options.newVersion, newArtifactDest, newSigDest, options.port);
    console.log(`\nManifest: ${manifestPath}`);

    // Install test app if requested
    if (options.install) {
      installTestApp(oldArtifactDest);
    }

    // Start server
    if (options.serve) {
      const server = await serveTestDir(options.port, oldArtifactDest);

      // Restore files on shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down...');
        server.close(() => {
          restoreFiles();
          process.exit(0);
        });
      });
    } else {
      console.log('\nBuild complete. Files are in:', TEST_DIR);
      restoreFiles();
    }
  } catch (err) {
    console.error('\nError:', err.message);
    restoreFiles();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  restoreFiles();
  process.exit(1);
});
