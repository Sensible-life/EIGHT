# Layer Lab · Galaxy Watch 개발 버전

Android 폰 앱과 Wear OS 워치 앱을 함께 설치합니다. 폰은 음악을 재생하고 워치는 미리 받은 진동 패턴을 자신의 시계로 예약합니다.
베이스의 저음 어택, 드럼 레이어의 저음 타격(킥 추정), 또는 둘 다를 선택할 수 있습니다. 감지 기준과 ±300ms 보정도 지원합니다.

## 실행

1. 폰과 워치를 Galaxy Wearable로 페어링하고 Bluetooth로 연결합니다.
2. 폰에 `app/android/app/build/outputs/apk/debug/app-debug.apk`, 워치에 `wear/build/outputs/apk/debug/LayerLabWatch-debug.apk`를 설치합니다. 아래 ADB 명령은 장치를 연결한 뒤 실행합니다.
3. 개발용 폰 앱은 Metro가 필요합니다. `app`에서 `npx expo start --dev-client --lan`을 실행하고 폰 앱에서 해당 개발 서버를 엽니다. 맥과 폰을 같은 Wi-Fi에 연결합니다. USB 연결이면 `adb -s PHONE_SERIAL reverse tcp:8081 tcp:8081`도 사용할 수 있습니다.
4. 워치에서 **Layer Lab**을 열고, 폰에서 베이스/드럼 레이어가 있는 곡을 엽니다. 로컬 파일 가져오기에도 동작하므로 LALAL API 키가 없어도 가능합니다.
5. 폰의 **손목으로 듣는 비트 → 워치 연결하고 진동 켜기**를 누릅니다. 연결된 기기 이름과 왕복 시간을 확인합니다.
6. **진동 테스트**로 모터를 확인하고 곡을 재생합니다. 진동이 늦게 느껴지면 보정값을 음수로 조절합니다. Bluetooth 이어폰의 오디오 지연도 함께 보정해야 합니다.

```bash
adb devices -l
adb -s PHONE_SERIAL install -r app/android/app/build/outputs/apk/debug/app-debug.apk
# 워치의 무선 디버깅에서 표시되는 페어링 포트와 연결 포트는 서로 다릅니다.
adb pair WATCH_IP:PAIRING_PORT
adb connect WATCH_IP:DEBUG_PORT
adb -s WATCH_IP:DEBUG_PORT install -r wear/build/outputs/apk/debug/LayerLabWatch-debug.apk
```

Data Layer 연결에는 **두 앱의 applicationId와 서명 인증서가 같아야 합니다**.
두 앱 모두 `com.systemdesign.choreolayer`이고, 워치 debug 빌드는 Expo가 생성한 `app/android/app/debug.keystore`를 사용합니다.
배포용으로 빌드할 때도 같은 앱 서명 인증서를 사용해야 합니다. 다른 키로 서명된 기존 앱은 함께 통신할 수 없습니다.

## 빌드와 검증

JDK 17과 Android SDK가 필요합니다. 폰의 네이티브 디렉터리는 Expo가 생성합니다. 생성된 파일을 직접 수정하지 않습니다.

```bash
cd app
npx expo prebuild --platform android --no-install
npm run lint
npm run typecheck
npm run test:audio
npm run test:haptics
cd android
./gradlew :app:assembleDebug
cd ../../wear
./gradlew testDebugUnitTest assembleDebug
```

워치에는 Google Play services Data Layer를 사용하는 Kotlin 앱이 들어 있습니다. 폰 모듈은 `app/modules/watch-haptics`에 있으며 Expo가 자동 연결합니다.

## 현재 동작 범위

- 폰과 워치 앱을 **화면에 열어 둔 상태**에서 사용하는 첫 버전입니다. 화면을 끄거나 다른 앱으로 이동하면 워치 연동을 중단하고 다시 연결해야 합니다. 워치 화면은 사용 중 켜 둡니다.
- 워치가 3.5초 동안 재생 상태를 받지 못하면 진동을 자동 중지합니다. 통신 실패 시 폰에도 연결 확인 메시지를 표시합니다.
- 3회 왕복 측정 중 가장 짧은 표본으로 두 장치의 단조 시계 차이를 추정합니다. 750ms마다 현재 재생 위치를 다시 전달합니다. 진동마다 원격 명령을 보내지는 않습니다.
- 재생·일시정지·탐색·전체 곡/구간 반복을 지원합니다. 조작 반영에는 통신 지연이 있으며 샘플 단위의 싱크를 보장하지 않습니다.
- 진동은 믹서 음소거·솔로·볼륨과 독립적입니다. 최저 140ms 간격, 한 번에 35ms 진동으로 과도한 연속 진동을 줄입니다.
- 드럼 저음 분석은 별도로 분리된 킥 트랙이 아니므로 톰 등 다른 저음 타격도 잡힐 수 있습니다. 음원 특성에 따라 감지 누락·오검출이 가능합니다.
- 세기 제어를 지원하지 않는 모터는 기본 진동 세기를 사용합니다. 방해 금지 모드와 기기 설정이 진동에 영향을 줄 수 있습니다.
- 긴 패턴은 80KB를 넘으면 명확한 오류를 표시합니다. 감지 기준을 높여 패턴 크기를 줄일 수 있습니다.
- 빌드·합성 음원 테스트까지 검증했으며 실제 Galaxy Watch 진동과 오디오 출력 지연은 실기기 검증이 필요합니다.

공식 문서: [Wear OS Data Layer](https://developer.android.com/training/wearables/data/overview), [MessageClient RPC](https://developers.google.com/android/reference/com/google/android/gms/wearable/MessageClient), [진동 API](https://developer.android.com/develop/ui/views/haptics/haptics-apis).
