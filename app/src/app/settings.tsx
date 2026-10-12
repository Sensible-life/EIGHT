import * as DocumentPicker from 'expo-document-picker';
import { exportBackup } from '../storage/backup';
import { mediaUsage, readTextFile } from '../storage/media';
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { api } from '../api';
import { useLibrary } from '../state/LibraryProvider';
import { C } from '../theme';
import { Button, Card, Heading, Page, ui } from '../ui/Kit';
export default function Settings() {
  const { data, setServer, restore } = useLibrary(); const [draft, setDraft] = useState(data.server), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const save = async () => { const url = draft.trim().replace(/\/$/, ''); if (!/^https?:\/\/[^\s]+$/.test(url)) { setStatus('http:// 또는 https://로 시작하는 서버 주소를 입력해 주세요.'); return; } setServer(url); setBusy(true); try { const health = await api.health(url); setStatus(health.providers?.lalal?.ready ? '서버 연결 완료 · LALAL.AI 사용 가능' : '서버 연결 완료 · LALAL.AI API 키 설정 필요'); } catch { setStatus('주소는 저장했어요. 서버 실행과 같은 Wi-Fi 연결을 확인해 주세요.'); } finally { setBusy(false); } };
  const backup = async () => { try { await exportBackup(data); setStatus('백업 내보내기를 요청했어요. 다운로드 또는 공유된 파일을 확인해 주세요. 음원·영상은 포함되지 않습니다.'); } catch (e) { setStatus(String(e)); } };
  const importBackup = async () => { try { const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true }); if (r.canceled) return; restore(await readTextFile(r.assets[0].uri)); setStatus('기존 기록을 보존하면서 백업 기록을 병합했어요.'); } catch (e) { setStatus(String(e)); } };
  return <Page><Heading title="연결 설정" caption="MAKE IT YOURS" /><Card><Text style={ui.h3}>음원 분리 서버</Text><Text style={ui.body}>맥에서 실행 중인 서버 주소를 입력해 주세요.</Text><TextInput accessibilityLabel="서버 주소" value={draft} onChangeText={setDraft} placeholder="http://192.168.0.10:8000" placeholderTextColor={C.dim} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={ui.input} /><Button title={busy ? '확인 중…' : '저장하고 연결 확인'} onPress={save} disabled={busy} />{!!status && <Text accessibilityLiveRegion="polite" style={ui.body}>{status}</Text>}</Card><Card><Text style={ui.h3}>기록 백업 · 저장 공간</Text><Button title="기록 JSON 내보내기" onPress={() => void backup()} secondary /><Button title="기록 JSON 가져오기 · 병합" onPress={() => void importBackup()} secondary /><Button title="저장 공간 확인" secondary onPress={() => void mediaUsage().then(bytes => setStatus(`보관한 음악·영상 ${(bytes / 1024 / 1024).toFixed(1)} MB · 프로젝트 ${data.projects.length}개. 프로젝트에서 다운로드 해제 또는 삭제할 수 있어요.`)).catch(e => setStatus(String(e)))} /><Text style={ui.small}>백업은 기록·좌표·설정만 포함해요. 다른 기기에서는 음악 파일을 프로젝트에서 다시 연결해 주세요. 복원 시 워치 설정과 미션 목표는 백업 값으로 바뀝니다.</Text>{!!status && <Text style={ui.body}>{status}</Text>}</Card><Card><Text style={ui.h3}>내 기록은 내 기기에</Text><Text style={ui.body}>프로젝트, 세션, 믹서 설정과 미션 기록은 이 기기에 저장해요. 프로젝트에서 오프라인 보관하면 서버 연결 없이 재생할 수 있어요.</Text><Text style={ui.small}>웹 파일은 IndexedDB, 휴대폰 파일은 앱 문서 폴더에 보관해요. 브라우저 데이터를 삭제하면 파일도 사라집니다.</Text></Card></Page>;
}
