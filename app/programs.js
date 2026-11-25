import {useCallback,useEffect,useRef,useState} from 'react';
import {router,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {ActivityIndicator,Pressable,SafeAreaView,ScrollView,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useUgerodTheme} from '../src/contexts/UgerodThemeContext';
import {fontFamilies} from '../src/constants/typography';
import {listPersonalWorkoutModels} from '../src/services/personalWorkoutModelService';
import {listLocalProgramDrafts,saveLocalProgramDraft} from '../src/services/localProgramDraftService';
import {groupPersonalModels} from '../src/utils/personalWorkoutModels';
import {newProgramDraft,programDraftWeeks} from '../src/utils/personalProgramDrafts';
import PersonalProgramDraftEditor,{localDraftId} from '../src/workout/PersonalProgramDraftEditor';

const PROGRAMS = [
  {
    id: 'first-pullup',
    category: 'SKILL',
    title: 'PREMIÈRE TRACTION',
    description: 'Construis la force et la technique nécessaires pour décrocher ta première traction stricte.',
    weeks: '6 SEMAINES',
    frequency: '3× / SEM.',
    level: 'DÉBUTANT',
    equipment: 'BARRE DE TRACTION',
    icon: 'body-outline',
    accent: 'blue',
    recommended: true,
    locked: true,
  },
  {
    id: 'kettlebell-foundations',
    category: 'FORCE',
    title: 'KETTLEBELL FOUNDATIONS',
    description: 'Maîtrise les mouvements essentiels et construis une base solide de force fonctionnelle.',
    weeks: '6 SEMAINES',
    frequency: '3× / SEM.',
    level: 'INTERMÉDIAIRE',
    equipment: 'KETTLEBELL',
    icon: 'barbell-outline',
    accent: 'red',
    recommended: true,
    locked: true,
  },
  {
    id: 'handstand',
    category: 'SKILL',
    title: 'HANDSTAND',
    description: 'Développe contrôle, gainage et confiance pour progresser vers un équilibre solide.',
    weeks: '8 SEMAINES',
    frequency: '3× / SEM.',
    level: 'INTERMÉDIAIRE',
    equipment: 'POIDS DU CORPS',
    icon: 'accessibility-outline',
    accent: 'blue',
    recommended: false,
    locked: true,
  },
  {
    id: 'engine-builder',
    category: 'CONDITIONING',
    title: 'ENGINE BUILDER',
    description: 'Améliore ta capacité à tenir l’effort et à mieux gérer les séances longues et intenses.',
    weeks: '6 SEMAINES',
    frequency: '3× / SEM.',
    level: 'TOUS NIVEAUX',
    equipment: 'MULTI-MATÉRIEL',
    icon: 'pulse-outline',
    accent: 'red',
    recommended: false,
    locked: true,
  },
  {
    id: 'shoulder-mobility',
    category: 'MOBILITÉ',
    title: 'ÉPAULES MOBILES',
    description: 'Travaille mobilité, contrôle et stabilité pour bouger plus librement au-dessus de la tête.',
    weeks: '4 SEMAINES',
    frequency: '4× / SEM.',
    level: 'TOUS NIVEAUX',
    equipment: 'ÉLASTIQUE',
    icon: 'fitness-outline',
    accent: 'blue',
    recommended: false,
    locked: true,
  },
];

// Historical Bootcamp cards are previews, not published paid/free products.
export default function ProgramsScreen(){
 const {colors:c}=useUgerodTheme();
 const params=useLocalSearchParams();
 const requestedSection=Array.isArray(params.section)?params.section[0]:params.section;
 const requestedCreate=Array.isArray(params.create)?params.create[0]:params.create;
 const [section,setSection]=useState(requestedSection==='discover'?'discover':'mine');
 const [models,setModels]=useState([]),[drafts,setDrafts]=useState([]),[ownerId,setOwnerId]=useState(null),[draft,setDraft]=useState(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[category,setCategory]=useState('Tous');
 const operation=useRef(false),ownerRef=useRef(null);
 useFocusEffect(useCallback(()=>{let active=true;setLoading(true);setError('');
  Promise.all([listPersonalWorkoutModels(),listLocalProgramDrafts()]).then(([items,local])=>{if(!active)return;if(ownerRef.current&&ownerRef.current!==local.ownerId)setDraft(null);ownerRef.current=local.ownerId;setOwnerId(local.ownerId);setModels(items);setDrafts(local.drafts);}).catch(()=>{if(active){setOwnerId(null);setModels([]);setDrafts([]);setDraft(null);setError('Impossible de charger tes programmes. Les brouillons locaux sont conservés.');}}).finally(()=>{if(active)setLoading(false)});
  return ()=>{active=false};
 },[retry]));
 useEffect(()=>{if(requestedSection==='mine'||requestedSection==='discover')setSection(requestedSection)},[requestedSection]);
 useEffect(()=>{if(requestedCreate==='1'&&!loading&&ownerId){setSection('mine');setDraft(old=>old??newProgramDraft(localDraftId()));router.setParams({create:'0',section:'mine'});}},[requestedCreate,loading,ownerId]);
 const txt={fontFamily:fontFamilies.regular,fontSize:14,color:c.text},bold={...txt,fontFamily:fontFamilies.semiBold},muted={...txt,fontSize:12,color:c.textSecondary};
 const {groups}=groupPersonalModels(models);
 const start=()=>{if(!loading&&ownerId&&!operation.current)setDraft(newProgramDraft(localDraftId()));};
 async function save(){
  if(!ownerId||!draft?.title.trim()||operation.current)return;
  operation.current=true;setBusy(true);setError('');
  try{const rows=await saveLocalProgramDraft(ownerId,draft);setDrafts(rows);setDraft(null);}
  catch(e){setError(e.message??'Impossible d’enregistrer le brouillon.');}
  finally{operation.current=false;setBusy(false);}
 }
 function switchSection(key){if(operation.current)return;setSection(key);router.setParams({section:key,create:'0'});}
 return <SafeAreaView style={{flex:1,backgroundColor:c.background}}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:18,paddingTop:14,paddingBottom:40,gap:16}}>
 {error?<View accessibilityRole="alert" style={{padding:12,backgroundColor:c.errorSoft,borderRadius:10,gap:8}}><Text style={txt}>{error}</Text><Pressable onPress={()=>setRetry(x=>x+1)}><Text style={bold}>Réessayer</Text></Pressable></View>:null}
 {draft&&!loading&&ownerId?<PersonalProgramDraftEditor key={draft.id} draft={draft} onChange={setDraft} onSave={save} onBack={()=>{if(!operation.current)setDraft(null)}} models={models} colors={c} busy={busy}/>:<>
 <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{fontFamily:fontFamilies.display,fontSize:32,color:c.text}}>PROGRAMMES.</Text><Pressable accessibilityLabel="Mon profil" onPress={()=>router.push('/profile')}><Ionicons name="person-circle-outline" size={30} color={c.text}/></Pressable></View>
 <View style={{flexDirection:'row',borderBottomWidth:1,borderBottomColor:c.border}}>{[['mine','Mes programmes'],['discover','Découvrir']].map(([key,label])=><Pressable accessibilityRole="tab" accessibilityState={{selected:section===key}} key={key} onPress={()=>switchSection(key)} style={{flex:1,minHeight:44,justifyContent:'center',borderBottomWidth:section===key?3:0,borderBottomColor:c.accent}}><Text style={{...bold,textAlign:'center',color:section===key?c.text:c.textSecondary}}>{label}</Text></Pressable>)}</View>
 {section==='mine'?<>
 <Pressable accessibilityRole="button" disabled={loading||!ownerId} onPress={start} style={{minHeight:64,backgroundColor:c.accent,borderRadius:15,flexDirection:'row',alignItems:'center',padding:15,gap:12,opacity:loading||!ownerId?0.5:1}}><Ionicons name="add-circle-outline" size={28} color={c.textOnAccent}/><View style={{flex:1,gap:3}}><Text style={{...bold,color:c.textOnAccent,fontSize:16}}>Créer un programme</Text><Text style={{...muted,color:c.textOnAccent}}>Tes phases, tes séances, ta progression.</Text></View><Ionicons name="arrow-forward" size={20} color={c.textOnAccent}/></Pressable>
 {loading?<ActivityIndicator color={c.accent}/>:<>
 {drafts.length?<Text style={bold}>Mes brouillons</Text>:null}
 {drafts.map(d=><Pressable key={d.id} accessibilityRole="button" onPress={()=>setDraft(d)} style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:72,borderBottomWidth:1,borderBottomColor:c.border,paddingVertical:8}}><Ionicons name="document-text-outline" size={25} color={c.accent}/><View style={{flex:1,gap:4}}><Text style={bold}>{d.title}</Text><Text style={muted}>{programDraftWeeks(d)} sem. · {d.phases.length} phases · Brouillon local</Text></View><Ionicons name="chevron-forward" size={18} color={c.textSecondary}/></Pressable>)}
 {groups.length?<Text style={bold}>Mes parcours existants</Text>:null}
 {groups.map(g=><Pressable key={g.id} accessibilityRole="button" onPress={()=>router.push({pathname:'/(tabs)/library',params:{section:'models',group:g.id}})} style={{padding:15,backgroundColor:c.surfacePressed,borderRadius:14,flexDirection:'row',gap:12,alignItems:'center'}}><Ionicons name={g.icon} size={35} color={c.accent}/><View style={{flex:1,gap:4}}><Text style={{...bold,fontSize:16}}>{g.title}</Text><Text style={muted}>{g.subtitle} · {g.models.length} modèles</Text></View><Ionicons name="arrow-forward" size={19} color={c.accent}/></Pressable>)}
 {!drafts.length&&!groups.length?<Text style={muted}>Construis ton premier programme à partir de tes modèles de séances.</Text>:null}
 <Text style={muted}>Les brouillons personnels sont conservés sur cet appareil pour l’instant. Ils ne sont ni publiés ni automatiquement planifiés.</Text>
 </>}
 </>:<>
 <View style={{gap:5}}><Text style={{fontFamily:fontFamilies.display,fontSize:26,color:c.text}}>BOOTCAMPS & COACHS.</Text><Text style={muted}>À terme, retrouve des programmes conçus par UGEROD et des coachs, accessibles à tous ou réservés aux abonnés Premium.</Text></View>
 <View style={{flexDirection:'row',flexWrap:'wrap',gap:7}}>{['Tous','SKILL','FORCE','CONDITIONING','MOBILITÉ'].map(key=><Pressable key={key} accessibilityRole="button" accessibilityState={{selected:category===key}} onPress={()=>setCategory(key)} style={{paddingHorizontal:12,minHeight:34,borderRadius:18,justifyContent:'center',backgroundColor:category===key?c.accent:c.surfacePressed}}><Text style={{...muted,color:category===key?c.textOnAccent:c.text}}>{({SKILL:'Technique',FORCE:'Force',CONDITIONING:'Conditionnement','MOBILITÉ':'Mobilité'})[key]??key}</Text></Pressable>)}</View>
 {PROGRAMS.filter(p=>category==='Tous'||p.category===category).map(p=><View key={p.id} style={{padding:15,backgroundColor:c.surface,borderRadius:15,gap:10,borderWidth:1,borderColor:c.border}}><View style={{flexDirection:'row',alignItems:'center',gap:12}}><View style={{width:58,height:58,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:c.accentSoft}}><Ionicons name={p.icon} size={32} color={c.accent}/></View><View style={{flex:1,gap:3}}><Text style={{...bold,fontSize:15}}>{p.title}</Text><Text style={muted}>UGEROD · À venir</Text></View></View><Text style={txt}>{p.description}</Text><Text style={muted}>{p.weeks.toLowerCase()} · {p.frequency.toLowerCase()} · {p.level.toLowerCase()}</Text><Text style={{...muted,color:c.textSecondary}}>Non disponible actuellement</Text></View>)}
 </>}
 </>}
 </ScrollView></SafeAreaView>;
}
