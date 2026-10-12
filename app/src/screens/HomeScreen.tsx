import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Job, LALAL_STEMS, LalalMode, LalalStem, SeparationProvider } from '../api';
import { C, STEM_LABELS } from '../theme';
import { demoJob } from '../audio/demo';

const MODELS = [ { id: 'htdemucs', label: '기본', hint: '4개 레이어' }, { id: 'htdemucs_ft', label: '고품질', hint: '4개 · 조금 더 오래' }, { id: 'htdemucs_6s', label: '6개', hint: '+기타 · 피아노' } ];
type Props = { server: string; setServer: (s: string) => void; onOpen: (job: Job) => void | Promise<void>; compact?: boolean };
const message = (title: string, detail: string) => { if (Platform.OS === 'web') window.alert(`${title}\n${detail}`); else Alert.alert(title, detail); };

export default function HomeScreen({ server, setServer, onOpen, compact = false }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]), [health, setHealth] = useState<string | null>(null);
  const [provider, setProvider] = useState<SeparationProvider>('lalal'), [lalalMode, setLalalMode] = useState<LalalMode>('multistem');
  const [lalalReady, setLalalReady] = useState(false), [model, setModel] = useState('htdemucs');
  const [uploading, setUploading] = useState(false), [showSetup, setShowSetup] = useState(false);
  const [importing, setImporting] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const openDemo = async () => { setDemoBusy(true); try { await onOpen(await demoJob()); } catch (e) { message('체험 음악을 열지 못했어요', String(e)); } finally { setDemoBusy(false); } };
  const [selectedStems, setSelectedStems] = useState<LalalStem[]>([...LALAL_STEMS]);
  const [splitVocals, setSplitVocals] = useState(false);
  const toggleStem = (stem: LalalStem) => {
    setSelectedStems(current => current.includes(stem) ? current.filter(item => item !== stem) : [...current, stem]);
    if (stem === 'vocals') setSplitVocals(false);
  };
  const multi = provider === 'lalal' && lalalMode === 'multistem';
  const cannotUpload = uploading || (provider === 'lalal' && !lalalReady) || health !== '연결됨' || (multi && selectedStems.length === 0);
  const refresh = useCallback(async () => { try { setJobs(await api.jobs(server)); } catch { /* local file import works without server */ } }, [server]);
  const check = useCallback(() => api.health(server).then(h => { setLalalReady(h.providers?.lalal?.ready === true); setHealth('연결됨'); void refresh(); }).catch(() => { setLalalReady(false); setHealth('서버 연결 필요'); setJobs([]); }), [server, refresh]);
  useEffect(() => { void check(); }, [check]);
  const busy = jobs.some(job => job.status !== 'done' && job.status !== 'error');
  useEffect(() => { if (!busy) return; const timer = setInterval(refresh, 1500); return () => clearInterval(timer); }, [busy, refresh]);
  const uploadAbort = useRef<AbortController | null>(null);
  const retryFile = useRef<DocumentPicker.DocumentPickerAsset | null>(null);
  const [uploadError, setUploadError] = useState('');
  useEffect(() => () => uploadAbort.current?.abort(), []);
  const pickAndUpload = async (retry = false) => {
    try {
      if (uploading) return;
      let asset = retryFile.current;
      if (!retry || !asset) { const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, base64: false }); if (result.canceled) return; asset = result.assets[0]; }
      retryFile.current = asset; setUploadError('');
      setUploading(true); uploadAbort.current = new AbortController();
      await api.upload(server, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file }, { model, shifts: 1, provider, lalalMode, lalalStems: multi ? selectedStems : undefined, splitVocals: multi && splitVocals }, uploadAbort.current.signal);
      await refresh();
    } catch (e) { setUploadError(uploadAbort.current?.signal.aborted ? '업로드를 중지했어요. 서버가 이미 받았다면 작업이 계속될 수 있으니 라이브러리를 먼저 새로고침하세요.' : String(e)); }
    finally { setUploading(false); }
  };
  const importLayers = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true, base64: false });
      if (result.canceled) return;
      if (result.assets.length < 2 || result.assets.length > 11) { message('레이어를 선택해 주세요', '같은 곡에서 분리한 파일 2~11개를 함께 선택해 주세요.'); return; }
      setImporting(true);
      const files: Record<string, string> = {};
      for (const asset of result.assets) {
        let stem = asset.name.replace(/\.[^.]+$/, '').toLowerCase();
        if (stem === 'drum') stem = 'drums';
        if (stem === 'no_vocals') stem = 'instrumental';
        if (stem === 'no_multistem') stem = 'other';
        if (stem === 'mix') stem = 'original';
        const base = stem;
        for (let suffix = 2; files[stem]; suffix++) stem = `${base} ${suffix}`;
        files[stem] = asset.uri;
      }
      await onOpen({ id: `local-${Date.now()}`, name: '내 레이어 믹스', status: 'done', stage: '완료', progress: 1,
        files, stems: Object.keys(files), config: { model: 'imported', shifts: 1, overlap: 0 }, createdAt: Date.now() / 1000 });
    } catch (e) { message('레이어를 가져오지 못했어요', String(e)); }
    finally { setImporting(false); }
  };
  const remove = (job: Job) => {
    const action = async () => { try { await api.remove(server, job.id); await refresh(); } catch (e) { message('삭제 실패', String(e)); } };
    if (Platform.OS === 'web') { if (window.confirm(`${job.name} 작업을 삭제할까요?`)) void action(); }
    else Alert.alert('작업을 삭제할까요?', job.name, [{ text: '취소', style: 'cancel' }, { text: '삭제', style: 'destructive', onPress: action }]);
  };
  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {!compact && <><View style={s.top}><Text style={s.brand}>LAYER<Text style={s.brandAccent}> / </Text>LAB</Text><View style={s.badge}><View style={s.dot} /><Text style={s.badgeText}>STEM MIXER</Text></View></View>
      <View style={s.hero}><Text style={s.eyebrow}>LISTEN DIFFERENTLY</Text><Text style={s.title}>음악을,<Text style={{ color: C.accent }}>{'\n레이어로.'}</Text></Text><Text style={s.subtitle}>{'보컬은 조금 더. 드럼은 조금 덜.\n당신의 귀에 맞는 밸런스를 찾아보세요.'}</Text>
        <View style={s.art}>{['#D3B8F4', '#E6BE8E', '#D9F28B', '#9BCDB3'].map((color, row) => <View key={color} style={s.artRow}><Text style={[s.artNumber, { color }]}>0{row + 1}</Text><View style={s.artWave}>{Array.from({ length: 42 }, (_, i) => <View key={i} style={{ flex: 1, borderRadius: 2, backgroundColor: color, opacity: 0.7, height: 3 + Math.abs(Math.sin(i * 0.63 + row * 2) * Math.cos(i * 0.19 + row)) * 23 }} />)}</View></View>)}</View>
      </View>
      </>}
      {compact && <View style={[s.importCard, { backgroundColor: C.cardHi, marginBottom: 16 }]}><Text style={s.importTitle}>먼저 리듬을 느껴볼까요?</Text><Text style={s.small}>베이스와 드럼으로 만든 16초 체험 음악 · 120 BPM</Text><Pressable accessibilityRole="button" disabled={demoBusy} onPress={openDemo} style={s.primary}><Text style={s.primaryText}>{demoBusy ? '체험 음악 준비 중…' : '체험 음악으로 시작'}</Text></Pressable></View>}
      <View style={s.importCard}><View style={s.importTop}><Text style={s.importTitle}>이미 분리된 파일이 있나요?</Text><Text style={s.folder}>↗</Text></View><Text style={s.small}>WAV · MP3 레이어를 함께 선택하면 바로 믹싱할 수 있어요.</Text><Pressable accessibilityRole="button" accessibilityLabel="분리된 파일 열기" style={s.primary} onPress={importLayers} disabled={importing}><Text style={s.primaryText}>{importing ? '파일 준비 중…' : '분리된 파일 열기'} <Text style={{ fontSize: 18 }}>＋</Text></Text></Pressable></View>
      <View style={s.sectionHead}><Text style={s.section}>새 음악 분리하기</Text><Pressable accessibilityRole="button" onPress={() => setShowSetup(v => !v)} style={s.settings}><Text style={s.settingsText}>{showSetup ? '설정 닫기' : '연결 설정'}</Text></Pressable></View>
      <View style={s.card}>
        {showSetup && <View style={s.setup}><Text style={s.label}>서버 주소</Text><View style={s.row}><TextInput accessibilityLabel="서버 주소" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} style={s.input} placeholder="http://192.168.0.10:8000" placeholderTextColor={C.dim} /><Pressable accessibilityRole="button" style={s.checkButton} onPress={check}><Text style={s.sub}>확인</Text></Pressable></View></View>}
        <View style={s.row}>{(['lalal', 'demucs'] as const).map(p => <Pressable accessibilityRole="button" accessibilityState={{ selected: provider === p }} key={p} onPress={() => setProvider(p)} style={[s.chip, provider === p && s.chipOn]}><Text style={[s.chipText, provider === p && { color: C.text }]}>{p === 'lalal' ? 'LALAL.AI' : 'Demucs'}</Text><Text style={s.chipHint}>{p === 'lalal' ? '클라우드 분리' : '로컬 분리'}</Text></Pressable>)}</View>
        <View style={[s.row, { marginTop: 10 }]}>{provider === 'lalal' ? ([{ id: 'multistem', label: '다양한 악기', hint: '최대 11개 레이어' }, { id: 'vocals', label: '보컬 + 반주', hint: '2개 레이어' }] as const).map(mode => <Pressable accessibilityRole="button" key={mode.id} onPress={() => setLalalMode(mode.id)} style={[s.chip, lalalMode === mode.id && s.modeOn]}><Text style={s.chipText}>{mode.label}</Text><Text style={s.chipHint}>{mode.hint}</Text></Pressable>) : MODELS.map(item => <Pressable accessibilityRole="button" key={item.id} onPress={() => setModel(item.id)} style={[s.chip, model === item.id && s.modeOn]}><Text style={s.chipText}>{item.label}</Text><Text style={s.chipHint}>{item.hint}</Text></Pressable>)}</View>
        {multi && <View style={s.selection}>
          <View style={s.selectionHead}><Text style={s.label}>분리할 레이어</Text><Pressable accessibilityRole="button" onPress={() => setSelectedStems([...LALAL_STEMS])}><Text style={s.settingsText}>모두 선택</Text></Pressable></View>
          <View style={s.stemGrid}>{LALAL_STEMS.map(stem => <Pressable key={stem} accessibilityRole="checkbox" accessibilityState={{ checked: selectedStems.includes(stem) }} aria-checked={selectedStems.includes(stem)} accessibilityLabel={stem === 'drum' ? '드럼' : STEM_LABELS[stem]} onPress={() => toggleStem(stem)} style={[s.stemChip, selectedStems.includes(stem) && s.chipOn]}><Text style={[s.chipText, selectedStems.includes(stem) && { color: C.text }]}>{selectedStems.includes(stem) ? '✓ ' : '＋ '}{stem === 'drum' ? '드럼' : STEM_LABELS[stem]}</Text></Pressable>)}</View>
          <Pressable accessibilityRole="checkbox" accessibilityLabel="리드 보컬과 코러스 나누기" aria-checked={splitVocals} aria-disabled={!selectedStems.includes('vocals')} accessibilityState={{ checked: splitVocals, disabled: !selectedStems.includes('vocals') }} disabled={!selectedStems.includes('vocals')} onPress={() => setSplitVocals(value => !value)} style={[s.vocalOption, !selectedStems.includes('vocals') && { opacity: 0.4 }]}><Text style={s.chipText}>{splitVocals ? '☑' : '□'} 리드 보컬과 코러스 나누기</Text><Text style={s.chipHint}>코러스가 감지된 곡에서 추가 레이어를 받아요.</Text></Pressable>
          <Text style={s.layerCount}>{selectedStems.length ? `${splitVocals ? '최대 ' : ''}${selectedStems.length + 1 + Number(splitVocals)}개 레이어 · 나머지 소리 포함` : '악기를 하나 이상 선택해 주세요'}</Text>
        </View>}
        <Text style={s.notice}>{provider === 'lalal' ? `음원이 LALAL.AI에 전송됩니다. 처리 분량: 곡 길이 × ${multi ? selectedStems.length : 1}` : '연결된 서버에서 음원을 분리합니다.'}</Text>
        <Pressable accessibilityRole="button" style={[s.upload, cannotUpload && { opacity: 0.4 }]} disabled={cannotUpload} onPress={() => void pickAndUpload()}>{uploading ? <ActivityIndicator color={C.accent} /> : <Text style={s.uploadText}>음원 선택하고 분리하기 ↗</Text>}</Pressable>
        {uploading && <Pressable accessibilityRole="button" onPress={() => uploadAbort.current?.abort()} style={s.upload}><Text style={s.uploadText}>업로드 중지</Text></Pressable>}
        {!!uploadError && <View><Text style={s.notice}>{uploadError}</Text><Pressable accessibilityRole="button" disabled={cannotUpload} onPress={() => void pickAndUpload(true)} style={s.upload}><Text style={s.uploadText}>같은 파일 다시 업로드</Text></Pressable></View>}
        <Text style={s.connection}>{health ?? '서버 확인 중'}{provider === 'lalal' && health === '연결됨' && !lalalReady ? ' · 서버 API 키 설정 필요' : ''}</Text>
      </View>
      <View style={s.sectionHead}><Text style={s.section}>라이브러리</Text><Pressable accessibilityRole="button" onPress={refresh}><Text style={s.settingsText}>새로고침 ↻</Text></Pressable></View>
      {!jobs.length ? <View style={s.empty}><Text style={s.emptyTitle}>첫 번째 믹스를 만들어보세요</Text><Text style={s.small}>음원을 분리하면 이곳에서 다시 열 수 있어요.</Text></View> : jobs.map(job => <Pressable accessibilityRole="button" key={job.id} style={s.job} onPress={() => job.status === 'done' && onOpen(job)} onLongPress={() => remove(job)}><View style={s.jobIcon}><Text style={s.jobIconText}>≋</Text></View><View style={{ flex: 1 }}><Text style={s.jobName} numberOfLines={1}>{job.name.replace(/\.[^.]+$/, '')}</Text><Text style={[s.jobMeta, job.status === 'error' && { color: C.err }]} numberOfLines={2}>{job.status === 'done' ? `${job.stems?.length}개 레이어 · 믹싱 준비 완료` : job.status === 'error' ? job.error : `${job.stage} · ${Math.round(job.progress * 100)}%`}</Text>{job.status !== 'done' && job.status !== 'error' && <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round(job.progress * 100)}%` }]} /></View>}</View><Text style={s.arrow}>{job.status === 'done' ? '↗' : '·'}</Text></Pressable>)}
      <Text style={s.footer}>LESS NOISE. MORE YOU.</Text>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }, content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 36 }, top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: C.text, fontSize: 15, letterSpacing: 2, fontWeight: '800' }, brandAccent: { color: C.accent }, badge: { flexDirection: 'row', gap: 5, alignItems: 'center' }, badgeText: { color: C.dim, fontSize: 8, letterSpacing: 1.2 }, dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent },
  hero: { paddingTop: 42, paddingBottom: 28 }, eyebrow: { color: C.dim, fontSize: 9, letterSpacing: 2, marginBottom: 16 }, title: { color: C.text, fontSize: 48, lineHeight: 58, fontWeight: '700', letterSpacing: -2.4 }, subtitle: { color: C.sub, fontSize: 13, lineHeight: 22, marginTop: 14 }, art: { marginTop: 24, gap: 7 }, artRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, artNumber: { fontSize: 8, letterSpacing: 1 }, artWave: { flex: 1, height: 24, flexDirection: 'row', gap: 3, alignItems: 'center' },
  importCard: { backgroundColor: C.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.line }, importTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, importTitle: { color: C.text, fontSize: 16, fontWeight: '600' }, folder: { color: C.accent, fontSize: 22 }, small: { color: C.dim, fontSize: 11, lineHeight: 18, marginTop: 5 }, primary: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 18 }, primaryText: { color: C.bg, fontSize: 14, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 30, marginBottom: 14 }, section: { color: C.text, fontSize: 16, fontWeight: '600' }, settings: { padding: 8 }, settingsText: { color: C.sub, fontSize: 10 }, card: { backgroundColor: C.card, borderRadius: 18, padding: 16 }, setup: { marginBottom: 16 }, label: { color: C.dim, fontSize: 10, marginBottom: 7 }, row: { flexDirection: 'row', gap: 8 }, input: { flex: 1, backgroundColor: C.bg, color: C.text, padding: 12, fontSize: 12, borderRadius: 10 }, checkButton: { padding: 12, justifyContent: 'center' }, sub: { color: C.sub, fontSize: 12 },
  chip: { flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 11, borderWidth: 1, borderColor: C.line }, chipOn: { borderColor: C.accent, backgroundColor: C.cardHi }, modeOn: { borderColor: C.sub }, chipText: { color: C.sub, fontSize: 12, fontWeight: '600' }, chipHint: { color: C.dim, fontSize: 9, marginTop: 5 }, notice: { color: C.dim, fontSize: 10, lineHeight: 16, marginTop: 14 }, upload: { borderWidth: 1, borderColor: C.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 14, marginTop: 14 }, uploadText: { color: C.accent, fontSize: 12, fontWeight: '600' }, connection: { color: C.dim, textAlign: 'center', fontSize: 9, marginTop: 10 },
  selection: { marginTop: 18 }, selectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }, stemGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, stemChip: { minWidth: '30%', flexGrow: 1, backgroundColor: C.bg, borderRadius: 10, padding: 11, borderWidth: 1, borderColor: C.line }, vocalOption: { paddingVertical: 14, marginTop: 4 }, layerCount: { color: C.accent, fontSize: 11, lineHeight: 17 },
  empty: { paddingVertical: 22, alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, borderRadius: 14 }, emptyTitle: { color: C.sub, fontSize: 12 }, job: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 14, borderRadius: 14, marginBottom: 8 }, jobIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.cardHi, justifyContent: 'center', alignItems: 'center' }, jobIconText: { color: C.accent, fontSize: 25 }, jobName: { color: C.text, fontSize: 14, fontWeight: '600' }, jobMeta: { color: C.dim, fontSize: 10, marginTop: 5 }, arrow: { color: C.sub, fontSize: 20 }, progressTrack: { height: 3, borderRadius: 2, backgroundColor: C.line, marginTop: 8 }, progressFill: { height: 3, backgroundColor: C.accent, borderRadius: 2 }, footer: { color: C.dim, fontSize: 8, letterSpacing: 2.4, textAlign: 'center', marginTop: 40 },
});
