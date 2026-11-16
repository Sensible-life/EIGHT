# Android APK와 EAS Update

이 프로젝트는 Expo 계정 `sensible_life`의 `choreo-layer` 프로젝트에 연결되어 있습니다. `preview` 프로필은 개발 서버 없이 실행되는 설치용 APK를 만들고, 같은 이름의 업데이트 채널을 사용합니다.

## APK 빌드

```bash
cd app
npm ci
npx eas-cli@latest build --platform android --profile preview
```

빌드가 완료되면 출력된 Expo 빌드 페이지에서 APK를 다운로드해 Android 기기에 설치합니다. Android 서명 키는 Expo 계정에 보관됩니다. 이전 APK가 다른 키로 서명됐다면 기존 앱을 지운 뒤 설치해야 할 수 있습니다. 이 경우 기존 앱의 기기 내부 데이터도 삭제될 수 있으므로 먼저 필요한 기록을 백업하세요.

## 화면과 앱 코드 원격 업데이트

APK 설치 이후에는 앱 코드나 이미지 같은 호환되는 변경을 `preview` 채널로 게시할 수 있습니다.

```bash
cd app
npx eas-cli@latest update --channel preview --environment preview --platform android --message "변경 내용"
```

설치된 APK는 앱 시작 시 업데이트를 확인합니다. 다운로드한 업데이트는 일반적으로 앱을 완전히 종료하고 다시 실행할 때 적용됩니다. 변경 사항을 확인하려면 필요할 경우 앱을 두 번 다시 실행하세요. 인터넷에 연결되어 있어야 업데이트를 받을 수 있습니다.

카메라·워치 연동, 네이티브 라이브러리, 권한이나 네이티브 설정 변경은 기존 APK에 원격으로 추가할 수 없습니다. 이런 변경을 빌드하기 전 `app/app.json`의 `expo.version`을 올리고 새 APK를 설치해야 합니다. 런타임 버전이 앱 버전과 같게 설정되어 있어 다른 네이티브 버전의 APK에는 업데이트가 전달되지 않습니다.

음원 분리 등 서버 기능은 별도 서버가 필요하며, 앱 원격 업데이트만으로 서버가 배포되지는 않습니다.
