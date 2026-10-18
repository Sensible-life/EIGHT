const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
const win = process.platform === 'win32';
const javaBin = home => path.join(home, 'bin', win ? 'java.exe' : 'java');
const candidates = [env.JAVA_HOME, '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home', '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home', '/Applications/Android Studio.app/Contents/jbr/Contents/Home', 'C:\\Program Files\\Android\\Android Studio\\jbr'].filter(Boolean);
const major = bin => { const r = spawnSync(bin, ['-version'], { encoding: 'utf8' }); const m = `${r.stderr ?? ''}${r.stdout ?? ''}`.match(/version "(\d+)(?:\.(\d+))?/); return m ? Number(m[1] === '1' ? m[2] : m[1]) : 0; };
const jdk = candidates.find(p => fs.existsSync(javaBin(p)) && major(javaBin(p)) >= 17);
if (jdk) { env.JAVA_HOME = jdk; env.PATH = `${path.join(jdk, 'bin')}${path.delimiter}${env.PATH ?? ''}`; }
else if (major('java') < 17) { console.error('Android 빌드에는 JDK 17 이상이 필요합니다. JDK 설치 후 JAVA_HOME을 지정하세요.'); process.exit(1); }
const sdk = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Library/Android/sdk'), path.join(os.homedir(), 'Android/Sdk'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android/Sdk')].filter(Boolean).find(p => fs.existsSync(path.join(p, 'platform-tools')));
if (sdk) { env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk; env.PATH = `${path.join(sdk, 'platform-tools')}${path.delimiter}${env.PATH ?? ''}`; }
else if (!fs.existsSync(path.join(root, 'android/local.properties'))) { console.error('Android SDK를 찾지 못했습니다. Android Studio에서 SDK 설치 후 ANDROID_HOME을 지정하세요.'); process.exit(1); }
console.log(`Android 환경: Java ${major(jdk ? javaBin(jdk) : 'java')} · SDK ${sdk ?? 'local.properties'}`);
const args = process.argv.slice(2);
if (args.includes('--check')) process.exit(0);
const buildOnly = args.includes('--build-only');
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
// Node refuses to spawn .bat files without a shell on Windows (CVE-2024-27980).
const child = buildOnly
  ? spawn(win ? '.\\gradlew.bat' : './gradlew', ['app:assembleDebug', '-x', 'lint', '-x', 'test', '--build-cache', '-PreactNativeDevServerPort=8081', '-PreactNativeArchitectures=arm64-v8a'], { cwd: path.join(root, 'android'), env, stdio: 'inherit', shell: win })
  : spawn(process.execPath, [cli, 'run:android', ...args], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
