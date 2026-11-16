import { Text, TextInput } from '../ui/Typography';
import { displayMessage } from '../ui/displayMessage';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { api, Job, LALAL_STEMS, LalalMode, LalalStem, SeparationProvider } from '../api';
import { C, STEM_LABELS } from '../theme';
import { Icon } from '../ui/Kit';

const MODELS = [ { id: 'htdemucs', label: "Standard", hint: "4 layers" }, { id: 'htdemucs_ft', label: "High quality", hint: "4 layers · slower" }, { id: 'htdemucs_6s', label: "6 layers", hint: "+ guitar · piano" } ];
type Props = { server: string; setServer: (s: string) => void; onOpen: (job: Job) => void | Promise<void>; compact?: boolean };
const message = (title: string, detail: string) => { if (Platform.OS === 'web') window.alert(`${title}\n${detail}`); else Alert.alert(title, detail); };

export default function HomeScreen({ server, setServer, onOpen, compact = false }: Props) {
  const { width, fontScale } = useWindowDimensions();
  const sideBySide = width >= 360 && fontScale <= 1.2;
  const [showSeparator, setShowSeparator] = useState(!compact);
  const [jobs, setJobs] = useState<Job[]>([]), [health, setHealth] = useState<string | null>(null);
  const [provider, setProvider] = useState<SeparationProvider>('lalal'), [lalalMode, setLalalMode] = useState<LalalMode>('multistem');
  const [lalalReady, setLalalReady] = useState(false), [model, setModel] = useState('htdemucs');
  const [uploading, setUploading] = useState(false), [showSetup, setShowSetup] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedStems, setSelectedStems] = useState<LalalStem[]>([...LALAL_STEMS]);
  const [splitVocals, setSplitVocals] = useState(false);
  const toggleStem = (stem: LalalStem) => {
    setSelectedStems(current => current.includes(stem) ? current.filter(item => item !== stem) : [...current, stem]);
    if (stem === 'vocals') setSplitVocals(false);
  };
  const multi = provider === 'lalal' && lalalMode === 'multistem';
  const cannotUpload = uploading || (provider === 'lalal' && !lalalReady) || health !== "Connected" || (multi && selectedStems.length === 0);
  const refresh = useCallback(async () => { try { setJobs(await api.jobs(server)); } catch { /* local file import works without server */ } }, [server]);
  const check = useCallback(() => api.health(server).then(h => { setLalalReady(h.providers?.lalal?.ready === true); setHealth("Connected"); void refresh(); }).catch(() => { setLalalReady(false); setHealth("Server connection required"); setJobs([]); }), [server, refresh]);
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
    } catch (e) { setUploadError(uploadAbort.current?.signal.aborted ? "Upload stopped. If the server already received the file, processing may continue. Refresh the library first." : displayMessage(e)); }
    finally { setUploading(false); }
  };
  const importLayers = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true, base64: false });
      if (result.canceled) return;
      if (result.assets.length < 2 || result.assets.length > 11) { message("Select layers", "Select 2–11 files separated from the same track."); return; }
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
      await onOpen({ id: `local-${Date.now()}`, name: "My layer mix", status: 'done', stage: "Completed", progress: 1,
        files, stems: Object.keys(files), config: { model: 'imported', shifts: 1, overlap: 0 }, createdAt: Date.now() / 1000 });
    } catch (e) { message("Could not import layers", displayMessage(e)); }
    finally { setImporting(false); }
  };
  const remove = (job: Job) => {
    const action = async () => { try { await api.remove(server, job.id); await refresh(); } catch (e) { message("Delete failed", displayMessage(e)); } };
    if (Platform.OS === 'web') { if (window.confirm(`${job.name} — delete this job?`)) void action(); }
    else Alert.alert("Delete this job?", job.name, [{ text: "Cancel", style: 'cancel' }, { text: "Delete", style: 'destructive', onPress: action }]);
  };
  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {!compact && <><View style={s.top}><Text style={s.brand}>LAYER<Text style={s.brandAccent}> / </Text>LAB</Text><View style={s.badge}><View style={s.dot} /><Text style={s.badgeText}>STEM MIXER</Text></View></View>
      <View style={s.hero}><Text style={s.eyebrow}>LISTEN DIFFERENTLY</Text><Text style={s.title}>Music,<Text style={{ color: C.accent }}>{'\n'}in layers.</Text></Text><Text style={s.subtitle}>Choose music and adjust each layer.</Text>
        <View style={s.art}>{['#D3B8F4', '#E6BE8E', '#D9F28B', '#9BCDB3'].map((color, row) => <View key={color} style={s.artRow}><Text style={[s.artNumber, { color }]}>0{row + 1}</Text><View style={s.artWave}>{Array.from({ length: 42 }, (_, i) => <View key={i} style={{ flex: 1, borderRadius: 2, backgroundColor: color, opacity: 0.7, height: 3 + Math.abs(Math.sin(i * 0.63 + row * 2) * Math.cos(i * 0.19 + row)) * 23 }} />)}</View></View>)}</View>
      </View>
      </>}
      <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={"Open separated files"} onPress={importLayers} disabled={importing} style={s.choice}><View style={s.choiceIcon}><Icon name="folder-open-outline" color={C.accent} size={20} /></View><Text style={s.importTitle}>{importing ? "Preparing…" : "Import layers"}</Text><Text style={s.small}>Separated WAV · MP3</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSeparator }} onPress={() => setShowSeparator(v => !v)} style={s.sectionHead}><View><Text style={s.section}>Separate a new track</Text><Text style={s.small}>Choose a track and split it into layers</Text></View><Text style={s.settingsText}>{showSeparator ? "Collapse −" : "Expand +"}</Text></Pressable>
      {showSeparator && <View style={s.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><Pressable accessibilityRole="button" onPress={() => setShowSetup(v => !v)} style={s.settings}><Text style={s.settingsText}>{showSetup ? "Close settings" : "Connection settings"}</Text></Pressable></View>
        {showSetup && <View style={s.setup}><Text style={s.label}>Server address</Text><View style={s.row}><TextInput accessibilityLabel={"Server address"} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} style={s.input} placeholder="http://192.168.0.10:8000" placeholderTextColor={C.dim} /><Pressable accessibilityRole="button" style={s.checkButton} onPress={check}><Text style={s.sub}>Confirm</Text></Pressable></View></View>}
        <View style={s.row}>{(['lalal', 'demucs'] as const).map(p => <Pressable accessibilityRole="button" accessibilityState={{ selected: provider === p }} key={p} onPress={() => setProvider(p)} style={[s.chip, provider === p && s.chipOn]}><Text style={[s.chipText, provider === p && { color: C.text }]}>{p === 'lalal' ? 'LALAL.AI' : 'Demucs'}</Text><Text style={s.chipHint}>{p === 'lalal' ? "Cloud separation" : "Local separation"}</Text></Pressable>)}</View>
        <View style={[s.row, { marginTop: 10 }]}>{provider === 'lalal' ? ([{ id: 'multistem', label: "Multiple instruments", hint: "Up to 11 layers" }, { id: 'vocals', label: "Vocals + accompaniment", hint: "2 layers" }] as const).map(mode => <Pressable accessibilityRole="button" key={mode.id} onPress={() => setLalalMode(mode.id)} style={[s.chip, lalalMode === mode.id && s.modeOn]}><Text style={s.chipText}>{mode.label}</Text><Text style={s.chipHint}>{mode.hint}</Text></Pressable>) : MODELS.map(item => <Pressable accessibilityRole="button" key={item.id} onPress={() => setModel(item.id)} style={[s.chip, model === item.id && s.modeOn]}><Text style={s.chipText}>{item.label}</Text><Text style={s.chipHint}>{item.hint}</Text></Pressable>)}</View>
        {multi && <View style={s.selection}>
          <View style={s.selectionHead}><Text style={s.label}>Layers to separate</Text><Pressable accessibilityRole="button" onPress={() => setSelectedStems([...LALAL_STEMS])}><Text style={s.settingsText}>Select all</Text></Pressable></View>
          <View style={s.stemGrid}>{LALAL_STEMS.map(stem => <Pressable key={stem} accessibilityRole="checkbox" accessibilityState={{ checked: selectedStems.includes(stem) }} aria-checked={selectedStems.includes(stem)} accessibilityLabel={stem === 'drum' ? "Drums" : STEM_LABELS[stem]} onPress={() => toggleStem(stem)} style={[s.stemChip, selectedStems.includes(stem) && s.chipOn]}><Text style={[s.chipText, selectedStems.includes(stem) && { color: C.text }]}>{selectedStems.includes(stem) ? '✓ ' : '＋ '}{stem === 'drum' ? "Drums" : STEM_LABELS[stem]}</Text></Pressable>)}</View>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={"Separate lead and backing vocals"} aria-checked={splitVocals} aria-disabled={!selectedStems.includes('vocals')} accessibilityState={{ checked: splitVocals, disabled: !selectedStems.includes('vocals') }} disabled={!selectedStems.includes('vocals')} onPress={() => setSplitVocals(value => !value)} style={[s.vocalOption, !selectedStems.includes('vocals') && { opacity: 0.4 }]}><Text style={s.chipText}>{splitVocals ? '☑' : '□'} Separate lead and backing vocals</Text><Text style={s.chipHint}>Adds a backing vocal layer when detected.</Text></Pressable>
          <Text style={s.layerCount}>{selectedStems.length ? `${splitVocals ? "Up to " : ''}${selectedStems.length + 1 + Number(splitVocals)} layers · includes remaining audio` : "Select at least one instrument"}</Text>
        </View>}
        <Text style={s.notice}>{provider === 'lalal' ? `The track will be sent to LALAL.AI. Processing: track length × ${multi ? selectedStems.length : 1}` : "The connected server separates the track."}</Text>
        <Pressable accessibilityRole="button" style={[s.upload, cannotUpload && { opacity: 0.4 }]} disabled={cannotUpload} onPress={() => void pickAndUpload()}>{uploading ? <ActivityIndicator color={C.accent} /> : <Text style={s.uploadText}>Choose and separate track ↗</Text>}</Pressable>
        {uploading && <Pressable accessibilityRole="button" onPress={() => uploadAbort.current?.abort()} style={s.upload}><Text style={s.uploadText}>Stop upload</Text></Pressable>}
        {!!uploadError && <View><Text style={s.notice}>{uploadError}</Text><Pressable accessibilityRole="button" disabled={cannotUpload} onPress={() => void pickAndUpload(true)} style={s.upload}><Text style={s.uploadText}>Re-upload the same file</Text></Pressable></View>}
        <Text style={s.connection}>{health ?? "Checking server"}{provider === 'lalal' && health === "Connected" && !lalalReady ? " · server API key required" : ''}</Text>
      </View>}
      <View style={s.sectionHead}><Text style={s.section}>Library</Text><Pressable accessibilityRole="button" onPress={refresh}><Text style={s.settingsText}>Refresh ↻</Text></Pressable></View>
      {!jobs.length ? <View style={s.empty}><Text style={s.emptyTitle}>No mixes yet</Text><Text style={s.small}>Separated tracks appear here.</Text></View> : jobs.map(job => <Pressable accessibilityRole="button" key={job.id} style={s.job} onPress={() => job.status === 'done' && onOpen(job)} onLongPress={() => remove(job)}><View style={s.jobIcon}><Text style={s.jobIconText}>≋</Text></View><View style={{ flex: 1 }}><Text style={s.jobName} numberOfLines={1}>{job.name.replace(/\.[^.]+$/, '')}</Text><Text style={[s.jobMeta, job.status === 'error' && { color: C.err }]} numberOfLines={2}>{job.status === 'done' ? `${job.stems?.length} layers · ready to mix` : job.status === 'error' ? displayMessage(job.error) : `${{ queued: 'Waiting', loading: 'Decoding audio', separating: 'Separating layers', analyzing: 'Analyzing beats and structure', encoding: 'Encoding layers' }[job.status] ?? 'Processing'} · ${Math.round(job.progress * 100)}%`}</Text>{job.status !== 'done' && job.status !== 'error' && <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round(job.progress * 100)}%` }]} /></View>}</View><Text style={s.arrow}>{job.status === 'done' ? '↗' : '·'}</Text></Pressable>)}
      <Text style={s.footer}>LESS NOISE. MORE YOU.</Text>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }, content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 }, top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: C.text, fontSize: 15, letterSpacing: 2, fontFamily: 'SpaceGrotesk_600SemiBold' }, brandAccent: { color: C.accent }, badge: { flexDirection: 'row', gap: 5, alignItems: 'center' }, badgeText: { color: C.dim, fontSize: 8, letterSpacing: 1.2 }, dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent },
  hero: { paddingTop: 42, paddingBottom: 28 }, eyebrow: { color: C.dim, fontSize: 9, letterSpacing: 2, marginBottom: 16 }, title: { color: C.text, fontSize: 48, lineHeight: 58, fontFamily: 'SpaceGrotesk_600SemiBold', letterSpacing: -2.4 }, subtitle: { color: C.sub, fontSize: 13, lineHeight: 22, marginTop: 14 }, art: { marginTop: 24, gap: 7 }, artRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, artNumber: { fontSize: 8, letterSpacing: 1 }, artWave: { flex: 1, height: 24, flexDirection: 'row', gap: 3, alignItems: 'center' },
  choice: { flex: 1, backgroundColor: C.card, borderRadius: 18, padding: 16, minHeight: 134, borderWidth: 1, borderColor: C.line, justifyContent: 'center' }, choiceIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFFAA', marginBottom: 10 },
  importCard: { backgroundColor: C.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.line }, importTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, importTitle: { color: C.text, fontSize: 16, fontFamily: 'SpaceGrotesk_600SemiBold' }, folder: { color: C.accent, fontSize: 22 }, small: { color: C.dim, fontSize: 11, lineHeight: 18, marginTop: 5 }, primary: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 18 }, primaryText: { color: C.bg, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 }, section: { color: C.text, fontSize: 16, fontFamily: 'SpaceGrotesk_600SemiBold' }, settings: { padding: 8 }, settingsText: { color: C.sub, fontSize: 10 }, card: { backgroundColor: C.card, borderRadius: 18, padding: 16 }, setup: { marginBottom: 16 }, label: { color: C.dim, fontSize: 10, marginBottom: 7 }, row: { flexDirection: 'row', gap: 8 }, input: { flex: 1, backgroundColor: C.bg, color: C.text, padding: 12, fontSize: 12, borderRadius: 10 }, checkButton: { padding: 12, justifyContent: 'center' }, sub: { color: C.sub, fontSize: 12 },
  chip: { flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 11, borderWidth: 1, borderColor: C.line }, chipOn: { borderColor: C.accent, backgroundColor: C.cardHi }, modeOn: { borderColor: C.sub }, chipText: { color: C.sub, fontSize: 12, fontFamily: 'SpaceGrotesk_600SemiBold' }, chipHint: { color: C.dim, fontSize: 9, marginTop: 5 }, notice: { color: C.dim, fontSize: 10, lineHeight: 16, marginTop: 14 }, upload: { borderWidth: 1, borderColor: C.accent, borderRadius: 10, alignItems: 'center', paddingVertical: 14, marginTop: 14 }, uploadText: { color: C.accent, fontSize: 12, fontFamily: 'SpaceGrotesk_600SemiBold' }, connection: { color: C.dim, textAlign: 'center', fontSize: 9, marginTop: 10 },
  selection: { marginTop: 18 }, selectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }, stemGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, stemChip: { minWidth: '30%', flexGrow: 1, backgroundColor: C.bg, borderRadius: 10, padding: 11, borderWidth: 1, borderColor: C.line }, vocalOption: { paddingVertical: 14, marginTop: 4 }, layerCount: { color: C.accent, fontSize: 11, lineHeight: 17 },
  empty: { paddingVertical: 22, alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, borderRadius: 14 }, emptyTitle: { color: C.sub, fontSize: 12 }, job: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 14, borderRadius: 14, marginBottom: 8 }, jobIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.cardHi, justifyContent: 'center', alignItems: 'center' }, jobIconText: { color: C.accent, fontSize: 25 }, jobName: { color: C.text, fontSize: 14, fontFamily: 'SpaceGrotesk_600SemiBold' }, jobMeta: { color: C.dim, fontSize: 10, marginTop: 5 }, arrow: { color: C.sub, fontSize: 20 }, progressTrack: { height: 3, borderRadius: 2, backgroundColor: C.line, marginTop: 8 }, progressFill: { height: 3, backgroundColor: C.accent, borderRadius: 2 }, footer: { color: C.dim, fontSize: 8, letterSpacing: 2.4, textAlign: 'center', marginTop: 40 },
});
