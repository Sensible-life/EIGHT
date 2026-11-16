// Older app binaries and development servers may still return Korean error messages.
// Translate known errors at the display boundary without changing stored data.
const messages: Record<string, string> = {
  '워치 앱을 열고 다시 연결해 주세요.': 'Open the watch app and reconnect.',
  '워치 응답 오류': 'Watch response error.',
  '워치 앱을 다시 열어 주세요.': 'Reopen the watch app.',
  '지원하지 않는 요청': 'Unsupported request.',
  '워치 오류': 'Watch error.',
  '가까운 워치를 찾지 못했어요. Bluetooth 연결과 워치 앱 설치를 확인해 주세요.': 'No nearby watch found. Check Bluetooth and install the watch app.',
  '워치에서 Layer Lab 앱을 열고 연결해 주세요.': 'Open Layer Lab on your watch and connect.',
  '자세 인식을 시작하지 못했어요.': 'Could not start pose detection.',
  '카메라를 시작하지 못했어요.': 'Could not start the camera.',
  '이미 녹화 중이에요.': 'Recording is already in progress.',
  '이 기기에서 카메라 분석과 녹화를 동시에 지원하지 않아요.': 'This device does not support simultaneous camera analysis and recording.',
  '영상을 저장하지 못했어요.': 'Could not save the video.',
  '이 카메라에서는 녹화할 수 없어요.': 'Recording is not supported by this camera.',
  '카메라 준비를 기다려 주세요.': 'Wait for the camera to be ready.',
  '카메라 화면을 열 수 없어요.': 'Could not open the camera.',
  '로그인이 필요해요.': 'Please sign in.',
  '로그인이 만료됐어요.': 'Your session has expired. Sign in again.',
  '잠시 후 다시 시도해 주세요.': 'Please try again later.',
  '아이디는 영문 소문자, 숫자, 밑줄 3~30자예요.': 'Usernames must be 3–30 lowercase letters, numbers, or underscores.',
  '이미 사용 중인 아이디예요.': 'This username is already in use.',
  '아이디 또는 비밀번호를 확인해 주세요.': 'Check your username and password.',
  '기록 형식 또는 크기를 확인해 주세요.': 'Check the format and size of the records.',
  '다른 기기에서 기록이 바뀌었어요. 먼저 내려받아 주세요.': 'Records changed on another device. Download them first.',
  '영상은 150MB 이하만 저장할 수 있어요.': 'Videos must be 150 MB or smaller.',
  '빈 영상은 저장할 수 없어요.': 'Empty videos cannot be saved.',
  '서버 저장 공간이 부족해요.': 'Server storage is full.',
  '영상을 찾을 수 없어요.': 'Video not found.',
  '내용을 입력해 주세요.': 'Enter some text.',
  '게시글을 찾을 수 없어요.': 'Post not found.',
  '내 글만 삭제할 수 있어요.': 'You can only delete your own posts.',
  '댓글은 1~300자예요.': 'Comments must be 1–300 characters.',
  '자신을 차단할 수 없어요.': 'You cannot block yourself.',
  '사용자를 찾을 수 없어요.': 'User not found.',
  '먼저 미션에 참여해 주세요.': 'Join the mission first.',
  '참여 후 시작한 세션만 기록할 수 있어요.': 'Only sessions started after joining can be submitted.',
  '권한이 없어요.': 'Permission denied.',
  '날짜를 확인해 주세요.': 'Check the date.',
  '서버에 LALAL_API_KEY를 설정하고 재시작해 주세요.': 'Set LALAL_API_KEY on the server and restart it.',
  '처리 중인 작업은 완료 후 삭제해 주세요.': 'Wait until processing finishes before deleting this job.',
};

export function displayMessage(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value ?? '');
  for (const [source, translated] of Object.entries(messages)) text = text.replaceAll(source, translated);
  return /[가-힣]/.test(text) ? 'An error occurred. Check the connection and try again.' : text;
}
